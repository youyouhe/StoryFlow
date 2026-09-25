/**
 * Canvas renderer for composite frame plans (P5a) — draws exactly what
 * `compositeSceneAt` resolved. No timing logic here: the renderer is a pure
 * function of (ctx, plan, size), which keeps the ≤1-frame caption accuracy
 * claim testable at the scene layer and the drawing swappable (WebCodecs /
 * server ffmpeg can reuse the same plan).
 */
import type { CompositeFramePlan } from './scene';

export const drawCompositeFrame = (
  ctx: CanvasRenderingContext2D,
  plan: CompositeFramePlan,
  width: number,
  height: number,
  /** Paint + clear with this color. Omit when base footage already painted —
   *  overlays then draw over the existing canvas contents. */
  background?: string,
): void => {
  if (background !== undefined) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }

  if (plan.title) drawTitle(ctx, plan.title, width, height);
  if (plan.caption) drawCaption(ctx, plan.caption, width, height);
  for (const sticker of plan.stickers) drawSticker(ctx, sticker, width, height);
};

/** Paint base footage full-frame (cover = crop to fill, contain = letterbox). */
export const drawBaseFrame = (
  ctx: CanvasRenderingContext2D,
  video: CanvasImageSource & { videoWidth: number; videoHeight: number },
  width: number,
  height: number,
  fit: 'cover' | 'contain',
  background = '#000000',
): void => {
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  const vw = video.videoWidth || width;
  const vh = video.videoHeight || height;
  const scale = fit === 'cover' ? Math.max(width / vw, height / vh) : Math.min(width / vw, height / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.drawImage(video, (width - dw) / 2, (height - dh) / 2, dw, dh);
};

const drawTitle = (
  ctx: CanvasRenderingContext2D,
  title: NonNullable<CompositeFramePlan['title']>,
  width: number,
  height: number,
): void => {
  ctx.save();
  ctx.font = `900 ${title.size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = title.color;
  const y = title.placement === 'top' ? title.size : title.placement === 'center' ? height / 2 : height - title.size;
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 8;
  ctx.fillText(title.text, width / 2, y, width * 0.92);
  ctx.restore();
};

const drawCaption = (
  ctx: CanvasRenderingContext2D,
  caption: NonNullable<CompositeFramePlan['caption']>,
  width: number,
  height: number,
): void => {
  const { style, lines } = caption;
  const lineHeight = style.size * 1.15;
  const blockBottom = height * style.y;
  ctx.save();
  ctx.font = `700 ${style.size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  lines.forEach((words, lineIndex) => {
    const y = blockBottom - (lines.length - 1 - lineIndex) * lineHeight;
    const text = words.map(w => w.text).join(' ');
    const widths = words.map(w => ctx.measureText(`${w.text} `).width);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = (width - total) / 2;

    if (style.background) {
      const pad = style.size * 0.3;
      ctx.fillStyle = style.background;
      roundRect(ctx, x - pad, y - style.size * 1.05, total + pad * 2, style.size * 1.4, style.size * 0.3);
      ctx.fill();
    }

    words.forEach((word, i) => {
      const wWidth = widths[i];
      const cx = x + wWidth / 2;
      ctx.lineWidth = style.strokeWidth ?? 0;
      if (style.strokeWidth) {
        ctx.strokeStyle = style.strokeColor ?? '#000';
        ctx.strokeText(word.text, cx, y);
      }
      ctx.fillStyle = word.active ? style.activeFill : style.fill;
      ctx.fillText(word.text, cx, y);
      if (word.active) {
        // karaoke underline pulse — marks the live word beyond color alone
        ctx.fillStyle = style.activeFill;
        ctx.fillRect(cx - wWidth * 0.35, y + style.size * 0.12, wWidth * 0.7, Math.max(3, style.size * 0.06));
      }
      x += wWidth;
    });
  });
  ctx.restore();
};

const drawSticker = (
  ctx: CanvasRenderingContext2D,
  sticker: NonNullable<CompositeFramePlan['stickers']>[number],
  width: number,
  height: number,
): void => {
  ctx.save();
  ctx.globalAlpha = sticker.opacity;
  const cardW = Math.min(width * 0.52, 560);
  const pad = 18;
  const fontSize = Math.max(18, Math.round(width / 42));
  ctx.font = `600 ${fontSize}px sans-serif`;
  const text = sticker.text.length > 64 ? `${sticker.text.slice(0, 63)}…` : sticker.text;
  const textW = ctx.measureText(text).width;
  const cardH = sticker.author ? fontSize * 2.8 : fontSize * 1.9;
  const x = (width - cardW) / 2;
  const y = height * 0.18;
  ctx.fillStyle = '#FFFFFFF2';
  roundRect(ctx, x, y, Math.max(cardW, textW + pad * 2), cardH, 16);
  ctx.fill();
  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'top';
  if (sticker.author) {
    ctx.font = `700 ${Math.round(fontSize * 0.8)}px sans-serif`;
    ctx.fillStyle = '#555555';
    ctx.fillText(sticker.author, x + pad, y + pad * 0.7);
    ctx.font = `600 ${fontSize}px sans-serif`;
    ctx.fillStyle = '#111111';
    ctx.fillText(text, x + pad, y + pad + fontSize);
  } else {
    ctx.fillText(text, x + pad, y + pad);
  }
  ctx.restore();
};

const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};
