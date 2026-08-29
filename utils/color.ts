import { Theme } from '../types';

/**
 * Color adaptation for light/dark themes.
 *
 * Users pick a single hex color (tuned for light mode). When the app switches
 * to dark mode, that same color often ends up too dark to read on a near-black
 * background. Instead of asking the user to maintain two palettes, we derive a
 * dark-mode variant automatically: boost lightness and soften saturation so the
 * hue is preserved but the text stays legible on dark backgrounds.
 *
 * Empty values are passed through untouched — those fall back to the Tailwind
 * theme classes (dark:text-*), which already handle light/dark correctly.
 */

const hexToRgb = (hex: string): [number, number, number] | null => {
  const m = hex.replace('#', '').match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const num = parseInt(h, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
};

const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
};

const hslToHex = (h: number, s: number, l: number): string => {
  h /= 360; s /= 100; l /= 100;
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

/**
 * Relative luminance (for WCAG contrast checks). Returns 0..1.
 */
const luminance = (hex: string): number => {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * Contrast ratio between two hex colors (1..21).
 */
const contrastRatio = (a: string, b: string): number => {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
};

// Dark-mode paper background (matches --color-paper-dark in index.css)
const DARK_BG = '#18181b';

// Below this saturation, a color is treated as neutral (black/gray/etc.).
// Neutral colors have no meaningful hue to preserve, so deriving a tinted
// variant from them only produces muddy off-grays — let them fall back to the
// Tailwind theme defaults (dark:text-*), which are already tuned for dark mode.
const NEUTRAL_SATURATION = 12;

/**
 * Adapt a user-chosen color for the current theme.
 *
 * Returns a hex string to apply as an inline text color, or '' to defer to the
 * Tailwind theme classes (dark:text-*). The caller treats '' as "no override".
 *
 * - Light theme: returned unchanged (a non-empty color, or '' if input is empty).
 * - Dark theme:
 *   - Empty/neutral colors → '' so Tailwind theme defaults apply. Neutrals
 *     (black/gray) have no hue worth preserving; forcing a tint just muddies
 *     them, and the user's black would otherwise stay black and vanish on dark.
 *   - Chromatic colors → hue preserved, lightness lifted and saturation
 *     softened to read well on a dark background. If the result still doesn't
 *     meet a minimum contrast ratio, lightness is pushed further until it does.
 * - Invalid input: returned unchanged.
 */
export const adaptColorForTheme = (color: string | undefined, theme: Theme): string => {
  if (!color) return '';
  if (theme !== 'dark') return color;

  const rgb = hexToRgb(color);
  if (!rgb) return color; // not a simple hex we can parse — leave as-is

  const [h, s, l] = rgbToHsl(...rgb);

  // Neutral (low-saturation) colors: defer to the theme defaults.
  if (s < NEUTRAL_SATURATION) return '';

  let newL = Math.min(75, l + Math.max(15, (80 - l) * 0.5));
  const newS = Math.max(40, s - 10);

  let candidate = hslToHex(h, newS, newL);

  // Ensure legibility: nudge lightness up until contrast against the dark
  // background clears a comfortable threshold for body-sized text.
  let guard = 0;
  while (contrastRatio(candidate, DARK_BG) < 4.5 && newL < 90 && guard < 20) {
    newL = Math.min(90, newL + 6);
    candidate = hslToHex(h, newS, newL);
    guard++;
  }

  return candidate;
};
