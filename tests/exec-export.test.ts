import { describe, it, expect } from 'vitest';

import type { ProSegmentCut } from '../services/videoExport';
import { exportProCutWithCuts, concatExpressClips, getAudioFrom } from '../src/exec/exportExec';
import { burnSubtitlesInto, subtitlesFilterArgs } from '../src/exec/exportExec';
import type { ExportExecDeps, ExportExecPorts } from '../src/exec/types';

const mockExportPorts = (over: Partial<ExportExecPorts> = {}) => {
  const calls: { fn: string; arg: unknown }[] = [];
  const ports: ExportExecPorts = {
    exportProCut: async (segments, opts) => {
      calls.push({ fn: 'exportProCut', arg: { segments, getAudio: opts.getAudio } });
      return new Blob(['pro-cut']);
    },
    concatClipsToMp4: async urls => {
      calls.push({ fn: 'concatClipsToMp4', arg: urls });
      return new Blob(['concat']);
    },
    ...over,
  };
  return { ports, calls };
};

const deps = (ports: ExportExecPorts): ExportExecDeps => ({ ports });

describe('exportProCutWithCuts — Pro 混音导出链', () => {
  it('threads cuts and the injected getAudio into exportProCut', async () => {
    const cuts: ProSegmentCut[] = [
      { videoUrl: 'vid://1', segKey: 'SHOT_003', ttsKeys: ['key:aud-tts-001'], bgmUrl: 'bgm://1' },
    ];
    const { ports, calls } = mockExportPorts();
    const blob = await exportProCutWithCuts(cuts, deps(ports), {
      getAudio: getAudioFrom({ 'key:aud-tts-001': new Blob(['wav']) }),
    });
    expect(await blob.text()).toBe('pro-cut');
    expect(calls[0].fn).toBe('exportProCut');
    const arg = calls[0].arg as { segments: ProSegmentCut[]; getAudio: (k: string) => Blob | undefined };
    expect(arg.segments).toBe(cuts);
    // getAudioFrom:audioExec 产物按 key 取出
    expect(arg.getAudio('key:aud-tts-001')).toBeInstanceOf(Blob);
    expect(arg.getAudio('nope')).toBeUndefined();
  });
});

describe('concatExpressClips — Express 顺序拼', () => {
  it('threads clip urls into concatClipsToMp4', async () => {
    const { ports, calls } = mockExportPorts();
    const blob = await concatExpressClips(['vid://a', 'vid://b'], deps(ports));
    expect(await blob.text()).toBe('concat');
    expect(calls[0]).toEqual({ fn: 'concatClipsToMp4', arg: ['vid://a', 'vid://b'] });
  });
});

describe('P14 字幕烧录 — 参数构造与执行步', () => {
  it('subtitlesFilterArgs:路径转义(盘符冒号/反斜杠)+ force_style 可选', () => {
    expect(subtitlesFilterArgs('subs.ass')).toEqual(['-vf', "subtitles='subs.ass'"]);
    expect(subtitlesFilterArgs('C:\\video\\subs.ass')).toEqual(['-vf', "subtitles='C\\:/video/subs.ass'"]); // 盘符冒号按滤镜规范转义
    expect(subtitlesFilterArgs('subs.ass', { forceStyle: 'FontSize=60' })).toEqual([
      '-vf', "subtitles='subs.ass':force_style='FontSize=60'",
    ]);
  });

  it('burnSubtitlesInto 线程 video+subtitles 至 port;未绑定即抛(libass 边界)', async () => {
    const seen: unknown[] = [];
    const ports = {
      exportProCut: async () => new Blob(['x']),
      concatClipsToMp4: async () => new Blob(['y']),
      burnSubtitles: async (input: { video: Blob; subtitles: string; format: 'srt' | 'ass' }) => {
        seen.push(input);
        return new Blob(['burned']);
      },
    };
    const video = new Blob(['mp4']);
    const out = await burnSubtitlesInto(video, '[Script Info]...', { ports }, { format: 'ass' });
    expect(await out.text()).toBe('burned');
    expect(seen[0]).toMatchObject({ video, subtitles: '[Script Info]...', format: 'ass' });

    const { ports: bare } = {
      ports: {
        exportProCut: async () => new Blob(['x']),
        concatClipsToMp4: async () => new Blob(['y']),
      } as typeof ports,
    };
    await expect(burnSubtitlesInto(video, 's', { ports: bare })).rejects.toThrow(/未绑定字幕烧录/);
  });
});
