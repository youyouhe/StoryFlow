/**
 * Pricing table — pre-submit cost estimates with HONEST unknowns
 * (P3 of docs/storyflow-adoption-plan.md).
 *
 * Rates are the documented 刊例/price-book values already cited in
 * services/minimaxService.ts (MiniMax H3, confirmed 2026-09-20) and
 * services/falService.ts (FAL gpt-image-2.5 derived per-image table).
 * A rate that is not in a price book here is reported as UNKNOWN — the plan
 * never guesses a price and never sums across currencies.
 */
import { estimateH3Cost, videoPrice } from '../../services/minimaxService';

export type Currency = 'CNY' | 'USD';

export interface PriceEstimate {
  /** Undefined = unknown price (explicitly marked, never guessed). */
  amount?: number;
  currency: Currency;
  /** Human-readable derivation ("输出 5s × ¥0.50/s + …") or why it is unknown. */
  note: string;
}

export const unknownPrice = (currency: Currency, note: string): PriceEstimate => ({ currency, note });

// ---------------------------------------------------------------------------
// Video (MiniMax H3 / H3-Max) — CNY, official 刊例
// ---------------------------------------------------------------------------

export const estimateVideoPrice = (p: {
  videoSeconds?: number;
  outputSeconds: number;
  imageCount: number;
  resolution: string;
  model?: string;
}): PriceEstimate => {
  const book = videoPrice(p.model, p.resolution);
  const output = p.outputSeconds * book.outputPerSec;
  const inputVideo = (p.videoSeconds ?? 0) * book.inputVideoPerSec;
  const extraImages = Math.max(0, p.imageCount - book.imageFree) * book.imageEach;
  const note =
    `输出 ${p.outputSeconds}s × ¥${book.outputPerSec.toFixed(2)}/s` +
    (p.videoSeconds ? ` + 参考视频 ${p.videoSeconds}s × ¥${book.inputVideoPerSec.toFixed(2)}/s` : '') +
    (p.imageCount > book.imageFree
      ? ` + 参考图 ${p.imageCount - book.imageFree} 张 × ¥${book.imageEach.toFixed(2)}/张`
      : ` + 参考图 ${p.imageCount} 张（前 ${book.imageFree} 张免费）`);
  // same inputs as estimateH3Cost — one source of truth for the number itself
  const amount = estimateH3Cost(p);
  return { amount, currency: 'CNY', note };
};

/** Self-hosted ComfyUI — GPU box, no API billing. */
export const estimateLocalVideoPrice = (): PriceEstimate => ({
  amount: 0,
  currency: 'CNY',
  note: '自托管 ComfyUI（GPU 本地）——无 API 计费',
});

// ---------------------------------------------------------------------------
// Images (FAL gpt-image-2.5) — USD, derived per-image table (falService)
// ---------------------------------------------------------------------------

const FAL_PER_IMAGE_USD: Record<string, Record<string, number>> = {
  'landscape_4_3': { low: 0.00402, medium: 0.00903, high: 0.03612, xhigh: 0.0642, max: 0.14445 },
  'square_hd': { low: 0.00588, medium: 0.01317, high: 0.05268, xhigh: 0.09366, max: 0.21072 },
  'portrait_4_3': { low: 0.00474, medium: 0.01029, high: 0.04116, xhigh: 0.07377, max: 0.16464 },
  'landscape_16_9': { low: 0.00441, medium: 0.01029, high: 0.0396, xhigh: 0.07041, max: 0.1584 },
};

export const estimateFalImagePrice = (size: string, quality: string, count = 1): PriceEstimate => {
  const row = FAL_PER_IMAGE_USD[size];
  const each = row?.[quality];
  if (each === undefined) {
    return unknownPrice('USD', `FAL 价目表无 ${size}×${quality} 单元——费用未知（不猜价）`);
  }
  return {
    amount: Math.round(each * count * 1e6) / 1e6,
    currency: 'USD',
    note: `FAL gpt-image-2.5 ${size}/${quality} $${each.toFixed(5)}/张 × ${count}（derived table）`,
  };
};

export const estimateMinimaxImagePrice = (count = 1): PriceEstimate =>
  unknownPrice('CNY', `minimax image-01 × ${count}——刊例未入库，费用未知（不猜价）`);
