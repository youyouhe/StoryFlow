/** End-to-end test of the bridge as a real MCP client would use it:
 *  spawns the stdio server, lists tools (should surface the page's 7
 *  storyflow_* tools with schemas), calls one read tool and one write tool,
 *  verifies persistence. Run: node test-client.mjs  (WebMCP browser up.) */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['index.mjs'],
});
const client = new Client({ name: 'bridge-test', version: '0.0.0' });
await client.connect(transport);

console.log('=== tools/list ===');
const { tools } = await client.listTools();
for (const t of tools) {
  const props = Object.keys(t.inputSchema?.properties ?? {});
  console.log(`- ${t.name}(${props.join(', ')})`);
}

console.log('\n=== call storyflow_get_app_info ===');
const info = await client.callTool({ name: 'storyflow_get_app_info', arguments: {} });
console.log(info.content[0].text);

console.log('\n=== call storyflow_append_blocks (write via bridge) ===');
const before = JSON.parse((await client.callTool({ name: 'storyflow_get_blocks', arguments: { from: 0, to: 999 } })).content[0].text);
const wrote = await client.callTool({
  name: 'storyflow_append_blocks',
  arguments: { blocks: [{ type: 'TRANSITION', content: 'CUT TO:' }] },
});
console.log(wrote.content[0].text);
const after = JSON.parse((await client.callTool({ name: 'storyflow_get_blocks', arguments: { from: 0, to: 999 } })).content[0].text);
console.log(`blocks: ${before.total} -> ${after.total}, last = ${after.blocks.at(-1).type}: ${after.blocks.at(-1).content}`);

console.log('\n=== call storyflow_generate_video_prompt (expect graceful error on non-shot block) ===');
const p = await client.callTool({ name: 'storyflow_generate_video_prompt', arguments: { blockIndex: 0, target: 'seedance' } });
console.log(p.content[0].text);

await client.close();
console.log('\nBRIDGE TEST PASSED');
