/**
 * 外挂字幕序列化(P11)—— CaptionTrack → SRT / WebVTT 文本。
 *
 * SRT:序号 + `HH:MM:SS,mmm --> HH:MM:SS,mmm`(逗号毫秒,CRLF 行尾,规范口径)。
 * WebVTT:`WEBVTT` 头 + `HH:MM:SS.mmm`(点毫秒,LF)。
 * 携带说话人时以 `[陈默]` 前缀行内标注(双行字幕/样式 = 扩展位)。
 */
import type { CaptionCue, CaptionTrack } from './compile';

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

const clock = (ms: number, sep: ',' | '.'): string => {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const mmm = total % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(mmm, 3)}`;
};

const cueText = (c: CaptionCue): string =>
  c.character ? `[${c.character}]${c.text}` : c.text;

/** SubRip(SRT):CRLF 行尾 + 逗号毫秒(规范口径)。 */
export const toSrt = (track: CaptionTrack): string =>
  track.captions
    .map((c, i) =>
      [
        String(i + 1),
        `${clock(c.startMs, ',')} --> ${clock(c.endMs, ',')}`,
        cueText(c),
      ].join('\r\n'),
    )
    .join('\r\n\r\n') + (track.captions.length ? '\r\n' : '');

/** WebVTT:WEBVTT 头 + 点毫秒(LF;cue 间空行,规范口径)。 */
export const toVtt = (track: CaptionTrack): string => {
  const blocks = track.captions.map((c, i) =>
    [
      String(i + 1),
      `${clock(c.startMs, '.')} --> ${clock(c.endMs, '.')}`,
      cueText(c),
    ].join('\n'),
  );
  return ['WEBVTT', '', blocks.join('\n\n')].join('\n') + (blocks.length ? '\n' : '');
};
