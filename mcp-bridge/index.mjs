#!/usr/bin/env node
/**
 * webmcp-bridge — a GENERIC stdio MCP server that proxies whatever WebMCP
 * tools a page registers on `document.modelContext`.
 *
 *   MCP client ──stdio(JSON-RPC)── this server ──CDP── Chromium (--enable-features=WebMCP)
 *                                                       └── any WebMCP-capable page
 *
 * The bridge is page-agnostic: `tools/list` forwards the page's WebMCP
 * registry (name / description / JSON Schema) and `tools/call` forwards to
 * `document.modelContext.executeTool()`. It never hardcodes a tool
 * inventory — point it at any site that exposes WebMCP tools and they
 * appear natively in your MCP client.
 *
 * Configuration (env vars):
 *   WEBMCP_BROWSER_URL  CDP endpoint to attach to.
 *                       Default: http://127.0.0.1:9222
 *   WEBMCP_PAGE_URL     Substring that identifies the target page's URL
 *                       (e.g. "localhost:5173"), or "*" for the first open
 *                       page where document.modelContext exists.
 *                       Default: "*" (legacy alias: STORYFLOW_PAGE_URL)
 *   WEBMCP_SERVER_NAME  Server name reported over MCP.
 *                       Default: "webmcp-bridge"
 *
 * Prerequisites — a browser with WebMCP + CDP, e.g.:
 *   chromium --enable-features=WebMCP --remote-debugging-port=9222 \
 *            --user-data-dir=$HOME/webmcp-profile http://localhost:5173/
 * (StoryFlow ships a convenience launcher: scripts/webmcp-chromium.sh)
 *
 * Register (Claude Code):
 *   claude mcp add webmcp -- node /path/to/mcp-bridge/index.mjs
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import puppeteer from 'puppeteer-core';

const BROWSER_URL = process.env.WEBMCP_BROWSER_URL || process.env.STORYFLOW_BROWSER_URL || 'http://127.0.0.1:9222';
const PAGE_MATCH = process.env.WEBMCP_PAGE_URL || process.env.STORYFLOW_PAGE_URL || '*';
const SERVER_NAME = process.env.WEBMCP_SERVER_NAME || 'webmcp-bridge';

const LAUNCH_HINT =
  'Launch a browser with WebMCP + CDP, e.g.: ' +
  'chromium --enable-features=WebMCP --remote-debugging-port=9222 <url>';

// ---- browser/page plumbing (lazy, self-healing) -----------------------------

let browser = null;

const getBrowser = async () => {
  if (browser?.connected) return browser;
  browser = await puppeteer.connect({ browserURL: BROWSER_URL, defaultViewport: null });
  browser.on('disconnected', () => { browser = null; });
  return browser;
};

const hasWebMCP = (page) =>
  page.evaluate(() => typeof document.modelContext === 'object' && !!document.modelContext);

/** Resolve the target page: URL-substring match, or (for "*") the first open
 *  page that actually exposes document.modelContext. */
const getTargetPage = async () => {
  const b = await getBrowser();
  const pages = await b.pages();
  if (PAGE_MATCH !== '*') {
    const page = pages.find(p => p.url().includes(PAGE_MATCH));
    if (!page) {
      throw new Error(
        `No page matching "${PAGE_MATCH}" is open in the browser at ${BROWSER_URL}. ` + LAUNCH_HINT
      );
    }
    if (!(await hasWebMCP(page))) {
      throw new Error(
        `The page matching "${PAGE_MATCH}" has no document.modelContext — the browser lacks ` +
        '--enable-features=WebMCP or the page is not a secure context (use localhost/https, not a LAN IP). ' + LAUNCH_HINT
      );
    }
    return page;
  }
  for (const page of pages) {
    try {
      if (await hasWebMCP(page)) return page;
    } catch { /* devtools:// and chrome:// pages throw on evaluate — skip */ }
  }
  throw new Error(
    `No open page exposes document.modelContext via ${BROWSER_URL}. ` + LAUNCH_HINT
  );
};

const safeParseSchema = (s) => {
  try { return JSON.parse(s); } catch { return { type: 'object', properties: {} }; }
};

// ---- MCP server --------------------------------------------------------------

const server = new Server(
  { name: SERVER_NAME, version: '0.2.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const page = await getTargetPage();
  const tools = await page.evaluate(async () => {
    const mc = document.modelContext;
    if (!mc) return null;
    const list = await mc.getTools();
    return list.map(t => ({
      name: t.name,
      description: t.description,
      // Chrome's getTools() hands inputSchema back as a JSON *string* in
      // current builds — tag it so the Node side can normalize to an object.
      inputSchema: typeof t.inputSchema === 'string' ? 'JSON:' + t.inputSchema : t.inputSchema,
    }));
  });
  if (!tools) throw new Error('WebMCP registry unreadable on the target page. ' + LAUNCH_HINT);
  return {
    tools: tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: typeof t.inputSchema === 'string' && t.inputSchema.startsWith('JSON:')
        ? safeParseSchema(t.inputSchema.slice(5))
        : (t.inputSchema ?? { type: 'object', properties: {} }),
    })),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const page = await getTargetPage();
    const result = await page.evaluate(async (toolName, argsJson) => {
      const mc = document.modelContext;
      if (!mc) return JSON.stringify({ ok: false, error: 'WebMCP unavailable on this page.' });
      const tools = await mc.getTools();
      const t = tools.find(x => x.name === toolName);
      if (!t) return JSON.stringify({ ok: false, error: `Unknown tool: ${toolName}. Re-list tools — the page registry may have changed.` });
      return await mc.executeTool(t, argsJson);
    }, name, JSON.stringify(args ?? {}));
    return { content: [{ type: 'text', text: result }] };
  } catch (e) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: false, error: String(e?.message || e) }) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[${SERVER_NAME}] ready — proxying WebMCP tools via ${BROWSER_URL} (page: ${PAGE_MATCH})`);
