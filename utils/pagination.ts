import { ScriptBlock } from '../types';

// Standard US Letter / A4 rough approximation in pixels at 96 DPI
// Content area is smaller due to padding.
const CONTENT_HEIGHT_LIMIT = 900; 
const CHARS_PER_LINE = 60; // Approximation for Courier Prime 12pt wrapping

const estimateBlockHeight = (block: ScriptBlock): number => {
  // Approximate pixel values based on Tailwind classes in EditorBlock
  // Line height ~ 1.5rem * 16px = 24px.
  // Using slightly conservative estimates.
  const lineHeight = 26; 
  
  // Count newlines explicitly or wrap
  const explicitLines = block.content.split('\n').length;
  // Estimated wrapping lines
  const wrappedLines = Math.ceil(block.content.length / CHARS_PER_LINE);
  
  const lines = Math.max(explicitLines, wrappedLines);
  const textHeight = lines * lineHeight;

  switch (block.type) {
    case 'SCENE_HEADING': 
        // mt-8 (32px) + mb-4 (16px) + text
        return 48 + textHeight; 
    case 'ACTION': 
        // mb-4 (16px)
        return 16 + textHeight; 
    case 'CHARACTER': 
        // mt-4 (16px)
        return 16 + textHeight; 
    case 'DIALOGUE': 
        // mb-4 (16px)
        return 16 + textHeight; 
    case 'PARENTHETICAL': 
        // mb-0
        return textHeight; 
    case 'TRANSITION': 
        // mt-6 (24px) + mb-4 (16px)
        return 40 + textHeight; 
    default: 
        return 20 + textHeight;
  }
};

export const paginateBlocks = (blocks: ScriptBlock[]): ScriptBlock[][] => {
  if (blocks.length === 0) return [[]];

  const pages: ScriptBlock[][] = [];
  let currentPage: ScriptBlock[] = [];
  let currentHeight = 0;

  blocks.forEach(block => {
    const h = estimateBlockHeight(block);

    // Basic logic: if block fits, add it. If not, new page.
    // Edge case: A single block larger than page? (e.g. huge monologue). 
    // We let it overflow for now rather than splitting the block itself.
    if (currentHeight + h > CONTENT_HEIGHT_LIMIT && currentPage.length > 0) {
      pages.push(currentPage);
      currentPage = [];
      currentHeight = 0;
    }

    currentPage.push(block);
    currentHeight += h;
  });

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  return pages;
};