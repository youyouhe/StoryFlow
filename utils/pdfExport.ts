import { ScriptBlock, ScriptMetadata, ScriptLanguage, PDFOptions, ColorSettings, BlockType } from '../types';
import { summarizeGraybox } from './exportData';

/**
 * Export screenplay to PDF using iframe + print
 */
export const exportToPDF = async (
  metadata: ScriptMetadata,
  blocks: ScriptBlock[],
  options: PDFOptions = {}
): Promise<void> => {
  const monoFont = getMonoFont(metadata.scriptLanguage);
  // Generate print HTML
  const printHTML = generatePrintHTML(metadata, blocks, monoFont, options.titlePage !== false, options);
  // Create iframe for printing
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';

  // Set document title for filename
  const originalTitle = document.title;
  const printFilename = options.filename || `${metadata.title.replace(/\.pdf$/, '')}`;
  document.title = printFilename.replace(/\.pdf$/, '');
  document.body.appendChild(iframe);
  // Write content to iframe
  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!iframeDoc) {
    console.error('[PDF Export] Failed to get iframe document');
    throw new Error('Failed to access iframe document');
  }

  iframeDoc.open();
  iframeDoc.write(printHTML);
  iframeDoc.close();
  // Wait for content to load
  await new Promise(resolve => setTimeout(resolve, 500));
  // Trigger print from iframe
  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();
  // Clean up after print
  setTimeout(() => {
    document.body.removeChild(iframe);
    document.title = originalTitle;
  }, 3000);
};

/**
 * Generate print HTML
 */
const generatePrintHTML = (
  metadata: ScriptMetadata,
  blocks: ScriptBlock[],
  monoFont: string,
  includeTitlePage: boolean,
  options: PDFOptions = {}
): string => {
  const colors = options.colors;
  // Determine font based on language
  const useMonoFont = metadata.scriptLanguage === 'en' || metadata.scriptLanguage === 'dual' || metadata.scriptLanguage === 'zh';
  const bodyFont = useMonoFont ? monoFont : 'serif';

  // Default colors if not provided
  const defaultColors: ColorSettings = {
    SCENE_HEADING: '#1a1a2e',
    ACTION: '#333',
    CHARACTER: '#0d47a1',
    DIALOGUE: '#1a1a1a',
    PARENTHETICAL: '#666',
    TRANSITION: '#1a1a2e'
  };

  const finalColors = colors || defaultColors;

  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${escapeHtml(metadata.title)}</title>
      <style>
        @page {
          size: Letter;
          margin: 1in;
        }
        /* Load Courier Prime from local file */
        @font-face {
          font-family: 'Courier Prime';
          src: url('/fonts/CourierPrime-Regular.woff2') format('woff2');
          font-display: swap;
        }
        * {
          box-sizing: border-box;
        }
        body {
          margin: 0;
          padding: 1in;
          font-family: ${bodyFont};
          font-size: 12pt;
          line-height: 1.5;
          color: #000;
        }
        /* Scene heading styling */
        .scene-heading {
          font-weight: bold;
          margin-top: 1.5in;
          margin-bottom: 0.25in;
          text-transform: uppercase;
          color: ${finalColors.SCENE_HEADING || '#1a1a2e'};
        }
        /* Action styling */
        .action {
          margin-bottom: 0.25in;
          line-height: 1.5;
          color: ${finalColors.ACTION || '#333'};
        }
        /* Character styling */
        .character {
          text-align: center;
          font-weight: bold;
          margin-top: 1rem;
          width: 66%;
          margin-left: auto;
          margin-right: auto;
          text-transform: uppercase;
          color: ${finalColors.CHARACTER || '#0d47a1'};
        }
        /* Dialogue styling */
        .dialogue {
          text-align: center;
          width: 75%;
          margin: 0 auto 0.25in;
          line-height: 1.5;
          color: ${finalColors.DIALOGUE || '#1a1a1a'};
        }
        /* Parenthetical styling */
        .parenthetical {
          text-align: center;
          width: 50%;
          margin: 0 auto;
          font-style: italic;
          color: ${finalColors.PARENTHETICAL || '#666'};
        }
        /* Transition styling */
        .transition {
          text-align: right;
          font-weight: bold;
          margin-top: 1in;
          width: 33%;
          margin-left: auto;
          text-transform: uppercase;
          color: ${finalColors.TRANSITION || '#1a1a2e'};
        }
        /* Title page styling */
        .title-page {
          min-height: 11in;
          display: flex;
          align-items: center;
          justify-content: center;
          page-break-after: always;
        }
        .title-page h1 {
          font-size: 48pt;
          font-weight: bold;
          margin-bottom: 3in;
          text-align: center;
        }
        .title-page .meta {
          font-size: 12pt;
          text-align: center;
        }
        .title-page .meta p {
          margin: 0.5em 0;
        }
        /* Appendix: AI payloads (storyboard prompts + graybox) per block.
           Kept out of the script body so it doesn't disturb the screenplay
           layout; rendered as a labeled appendix after the script. */
        .appendix {
          page-break-before: always;
          margin-top: 1in;
        }
        .appendix h2 {
          font-size: 14pt;
          font-weight: bold;
          margin-bottom: 0.5in;
          border-bottom: 1px solid #999;
          padding-bottom: 0.1in;
        }
        .appendix-entry {
          margin-bottom: 0.4in;
          page-break-inside: avoid;
        }
        .appendix-entry .anchor {
          font-size: 9pt;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.1in;
        }
        .appendix-entry .label {
          font-weight: bold;
          font-size: 11pt;
          margin-top: 0.15in;
        }
        .appendix-entry .summary {
          font-size: 10pt;
          color: #444;
          font-style: italic;
        }
        .appendix-entry pre {
          font-family: 'Courier Prime', 'Courier New', monospace;
          font-size: 8.5pt;
          line-height: 1.35;
          background: #f5f5f5;
          border: 1px solid #ddd;
          padding: 0.15in;
          white-space: pre-wrap;
          word-break: break-word;
          margin-top: 0.05in;
        }
      </style>
    </head>
    <body>
  `;

  // Title page
  if (includeTitlePage) {
    html += `
      <div class="title-page">
        <div>
          <h1>${escapeHtml(metadata.title)}</h1>
          <div class="meta">
            <p>Written by ${escapeHtml(metadata.author)}</p>
            <p>${escapeHtml(metadata.draft)}</p>
            <p>${new Date().toLocaleDateString()}</p>
          </div>
        </div>
      </div>
    `;
  }

  // Script content with proper screenplay formatting
  for (const block of blocks) {
    const content = escapeHtml(block.content);
    switch (block.type) {
      case 'SCENE_HEADING':
        html += `<div class="scene-heading">${content}</div>\n`;
        break;
      case 'ACTION':
        html += `<div class="action">${content}</div>\n`;
        break;
      case 'CHARACTER':
        html += `<div class="character">${content}</div>\n`;
        break;
      case 'DIALOGUE':
        html += `<div class="dialogue">${content}</div>\n`;
        break;
      case 'PARENTHETICAL':
        html += `<div class="parenthetical">${content}</div>\n`;
        break;
      case 'TRANSITION':
        html += `<div class="transition">${content}</div>\n`;
        break;
    }
  }

  // Appendix: AI payloads (storyboard prompts + graybox) per block. Only
  // emitted when the caller asked for either payload. Renders after the script
  // body on its own page-break so the screenplay layout is undisturbed.
  const wantPrompt = options.includeImagePrompts;
  const wantGraybox = options.includeGraybox;
  if (wantPrompt || wantGraybox) {
    const entries: string[] = [];
    blocks.forEach((block, i) => {
      const hasP = wantPrompt && block.imagePrompt?.trim();
      const hasG = wantGraybox && block.graybox;
      if (!hasP && !hasG) return;
      const anchorParts = [`Block ${i + 1}`, block.type];
      if (options.includeBlockIds) anchorParts.push(block.id);
      const anchor = escapeHtml(anchorParts.join(' · '));
      let entry = `<div class="appendix-entry"><div class="anchor">${anchor}</div>`;
      if (hasP) {
        entry += `<div class="label">Storyboard prompt</div>`;
        entry += `<pre>${escapeHtml(block.imagePrompt!.trim())}</pre>`;
      }
      if (hasG) {
        const g = block.graybox!;
        if (options.grayboxFormat === 'summary') {
          entry += `<div class="label">Graybox</div><div class="summary">${escapeHtml(summarizeGraybox(g))}</div>`;
        } else {
          entry += `<div class="label">Graybox (JSON)</div>`;
          entry += `<pre>${escapeHtml(JSON.stringify(g, null, 2))}</pre>`;
        }
      }
      entry += `</div>`;
      entries.push(entry);
    });
    if (entries.length) {
      html += `<div class="appendix"><h2>Appendix — AI Payloads</h2>`;
      html += entries.join('\n');
      html += `</div>`;
    }
  }

  html += `
    </body>
    </html>
  `;

  return html;
};

/**
 * Get appropriate monospace font based on script language
 */
const getMonoFont = (language: ScriptLanguage): string => {
  if (language === 'zh' || language === 'dual') {
    // Use system Chinese fonts for dual-language support
    return '"Microsoft YaHei", "SimHei", "PingFang SC", "Courier Prime", "Courier New", monospace';
  }
  // Use local Courier Prime for English
  return '"Courier Prime", "Courier New", "Consolas", monospace';
};

/**
 * Escape HTML special characters
 */
const escapeHtml = (text: string): string => {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

/**
 * Create print container element (no longer needed, kept for compatibility)
 */
export const createPrintContainer = (
  metadata: ScriptMetadata,
  blocks: ScriptBlock[],
  titlePage: boolean = true,
  colors?: ColorSettings
): HTMLElement => {
  const monoFont = getMonoFont(metadata.scriptLanguage);
  const container = document.createElement('div');
  container.innerHTML = generatePrintHTML(metadata, blocks, monoFont, titlePage, { colors });
  return container;
};
