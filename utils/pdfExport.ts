import { ScriptBlock, ScriptMetadata, ScriptLanguage, PDFOptions, ColorSettings, BlockType } from '../types';

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
  console.log('[PDF Export] Colors:', options.colors);

  const monoFont = getMonoFont(metadata.scriptLanguage);
  console.log('[PDF Export] Font:', monoFont);

  // Generate print HTML
  const printHTML = generatePrintHTML(metadata, blocks, monoFont, options.titlePage !== false, options.colors);
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
  includeTitlePage: boolean,
  colors?: ColorSettings
): string => {
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
  container.innerHTML = generatePrintHTML(metadata, blocks, monoFont, titlePage, colors);
  return container;
};
