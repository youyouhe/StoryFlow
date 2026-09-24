/**
 * FAL provider — gpt-image-2.5 image generation (P4).
 *
 * Deployment: direct (queue.fal.run / rest.fal.ai, CORS verified 2026-09 —
 * see services/falService.ts). Size/quality cells come from the published
 * derived price table and out-of-preset requests are REFUSED with a reason.
 */
import { generateImages } from '../minimaxService';
import { FAL_SIZE_FOR_ASPECT, DEFAULT_FAL_MODEL } from '../falService';
import { accepts, refuses, type CapabilityId, type ImageRequest, type Provider, type SupportsResult } from './types';

const CANONICAL_SIZES = new Set(Object.values(FAL_SIZE_FOR_ASPECT));
const QUALITIES = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

export const falProvider: Provider = {
  id: 'fal',
  label: 'FAL（gpt-image-2.5）',
  capabilities: ['image.generate'],
  deployment: 'direct',
  deploymentNote: 'queue.fal.run + rest.fal.ai 直连（CORS 已验证）；密钥 slot: fal',

  supports(capability: CapabilityId, request: unknown): SupportsResult {
    if (capability !== 'image.generate') return refuses(`fal 不提供能力 ${capability}`);
    const req = request as ImageRequest;
    if (req.size !== undefined && !CANONICAL_SIZES.has(req.size)) {
      return refuses(`FAL 无预设尺寸 ${req.size}（可选：${[...CANONICAL_SIZES].join(' / ')}）——不会静默改尺寸`);
    }
    if (req.quality !== undefined && !QUALITIES.has(req.quality)) {
      return refuses(`FAL 无质量档 ${req.quality}（可选：${[...QUALITIES].join(' / ')}）——不会静默降档`);
    }
    return accepts();
  },

  async generateImage(ctx, req: ImageRequest) {
    const images = await generateImages(
      {
        apiKey: '',
        baseUrl: '',
        provider: 'fal',
        falKey: ctx.apiKey,
        falModel: String(ctx.config.model ?? DEFAULT_FAL_MODEL),
        falQuality: (req.quality === 'high' ? 'high' : 'low') as 'low' | 'high',
      },
      req.prompt,
      {
        n: req.n ?? 1,
        aspectRatio: req.aspectRatio ?? '16:9',
        subjectReference: req.subjectReference,
        references: req.references,
      },
    );
    return images.map(im => ({ blob: im.blob as Blob }));
  },
};
