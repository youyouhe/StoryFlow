import { ScriptBlock, ScriptMetadata, ScriptLanguage } from '../types';

export interface PDFOptions {
  titlePage?: boolean;
  filename?: string;
}

/**
 * Export screenplay to PDF using iframe + print
 */
export const exportToPDF = async (
  metadata: ScriptMetadata,
  blocks: ScriptBlock[],
  options: PDFOptions = {}
): Promise<void> => {
  console.log('[PDF Export] Starting export...');
  console.log('[PDF Export] Metadata:', metadata);
  console.log('[PDF Export] Blocks count:', blocks.length);

  const monoFont = getMonoFont(metadata.scriptLanguage);
  console.log('[PDF Export] Font:', monoFont);

  // Generate print HTML
  const printHTML = generatePrintHTML(metadata, blocks, monoFont, options.titlePage !== false);
  console.log('[PDF Export] Generated print HTML, length:', printHTML.length);

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
  console.log('[PDF Export] Document title set to:', document.title);

  document.body.appendChild(iframe);
  console.log('[PDF Export] Iframe added to DOM');

  // Write content to iframe
  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!iframeDoc) {
    console.error('[PDF Export] Failed to get iframe document');
    throw new Error('Failed to access iframe document');
  }

  iframeDoc.open();
  iframeDoc.write(printHTML);
  iframeDoc.close();
  console.log('[PDF Export] Content written to iframe');

  // Wait for content to load
  await new Promise(resolve => setTimeout(resolve, 500));
  console.log('[PDF Export] Content loaded, triggering print...');

  // Trigger print from iframe
  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();

  console.log('[PDF Export] Print triggered');

  // Clean up after print
  setTimeout(() => {
    document.body.removeChild(iframe);
    document.title = originalTitle;
    console.log('[PDF Export] Cleanup complete');
  }, 3000);
};

/**
 * Generate print HTML
 */
const generatePrintHTML = (
  metadata: ScriptMetadata,
  blocks: ScriptBlock[],
  monoFont: string,
  includeTitlePage: boolean
): string => {
  // Use only system default fonts to avoid loading issues
  const systemFont = 'serif';

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
        body {
          margin: 0;
          padding: 1in;
          font-family: ${systemFont};
          font-size: 12pt;
          line-height: 1.5;
        }
      </style>
    </head>
    <body>
  `;

  // Title page
  if (includeTitlePage) {
    html += `
      <div style="page-break-after: always; min-height: 11in; display: flex; align-items: center; justify-content: center;">
        <div style="text-align: center;">
          <h1 style="font-size: 48pt; font-weight: bold; margin-bottom: 3in;">${escapeHtml(metadata.title)}</h1>
          <div style="font-size: 12pt;">
            <p>Written by ${escapeHtml(metadata.author)}</p>
            <p>${escapeHtml(metadata.draft)}</p>
            <p>${new Date().toLocaleDateString()}</p>
          </div>
        </div>
      </div>
    `;
  }

  // Script content - extremely simple
  for (const block of blocks) {
    const content = escapeHtml(block.content);
    switch (block.type) {
      case 'SCENE_HEADING':
        html += `<div style="font-weight: bold; margin-top: 1.5in;">${content}</div>\n`;
        break;
      case 'ACTION':
        html += `<div>${content}</div>\n`;
        break;
      case 'CHARACTER':
        html += `<div style="text-align: center; font-weight: bold;">${content}</div>\n`;
        break;
      case 'DIALOGUE':
        html += `<div style="text-align: center; margin-bottom: 0.25in;">${content}</div>\n`;
        break;
      case 'PARENTHETICAL':
        html += `<div style="text-align: center; font-style: italic;">${content}</div>\n`;
        break;
      case 'TRANSITION':
        html += `<div style="text-align: right; font-weight: bold;">${content}</div>\n`;
        break;
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
    // Use system Chinese fonts (no download needed)
    return '"Microsoft YaHei", "SimHei", "PingFang SC", sans-serif';
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
  titlePage: boolean = true
): HTMLElement => {
  const monoFont = getMonoFont(metadata.scriptLanguage);
  const container = document.createElement('div');
  container.innerHTML = generatePrintHTML(metadata, blocks, monoFont, titlePage);
  return container;
};
