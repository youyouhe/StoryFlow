/**
 * Semantic anchor identities — the P2 word-level time substrate
 * (docs/storyflow-adoption-plan.md).
 *
 * A tokenized script exposes exactly `2M + 2N + 2` ordered semantic anchors
 * (Hypit's identity law): two per token, two per block, plus program start and
 * end. Anchors are AUTHOR IDENTITY — they survive re-projection; seconds and
 * frames are what projection computes FROM them and may change on every edit.
 *
 * Ids are derived from structural position (`t_<blockId>_<i>:s`) so the same
 * text always yields the same identity, and marks can name a bound as
 * (blockId, gap, snap) without storing volatile anchor tables.
 */
import type { ScriptToken } from '../../types';

export type AnchorKind =
  | 'program-start' | 'program-end'
  | 'block-start' | 'block-end'
  | 'token-start' | 'token-end';

export interface SemanticAnchor {
  id: string;
  kind: AnchorKind;
  blockId?: string;
  tokenIndex?: number;
}

export const programStartAnchorId = 'p:s';
export const programEndAnchorId = 'p:e';
export const blockStartAnchorId = (blockId: string): string => `b:${blockId}:s`;
export const blockEndAnchorId = (blockId: string): string => `b:${blockId}:e`;
export const tokenStartAnchorId = (blockId: string, index: number): string => `t:${blockId}:${index}:s`;
export const tokenEndAnchorId = (blockId: string, index: number): string => `t:${blockId}:${index}:e`;

/**
 * Build the complete ordered anchor list for a tokenized script.
 *
 * Order: program start → per block (block start, per token (token start,
 * token end), block end) → program end. Gaps between blocks and the program
 * edges are therefore addressable even with zero tokens in a block.
 */
export const buildAnchors = (
  blockIds: string[],
  tokensByBlock: Map<string, ScriptToken[]>,
): SemanticAnchor[] => {
  const anchors: SemanticAnchor[] = [
    { id: programStartAnchorId, kind: 'program-start' },
  ];
  for (const blockId of blockIds) {
    anchors.push({ id: blockStartAnchorId(blockId), kind: 'block-start', blockId });
    const tokens = tokensByBlock.get(blockId) ?? [];
    for (let i = 0; i < tokens.length; i++) {
      anchors.push({ id: tokenStartAnchorId(blockId, i), kind: 'token-start', blockId, tokenIndex: i });
      anchors.push({ id: tokenEndAnchorId(blockId, i), kind: 'token-end', blockId, tokenIndex: i });
    }
    anchors.push({ id: blockEndAnchorId(blockId), kind: 'block-end', blockId });
  }
  anchors.push({ id: programEndAnchorId, kind: 'program-end' });
  return anchors;
};

/** The identity law: exactly 2M + 2N + 2 anchors (M tokens, N blocks). */
export const expectedAnchorCount = (blockCount: number, tokenCount: number): number =>
  2 * tokenCount + 2 * blockCount + 2;
