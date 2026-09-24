import { describe, it, expect } from 'vitest';

import type { ProSegmentCut } from '../services/videoExport';
import { exportProCutWithCuts, concatExpressClips, getAudioFrom } from '../src/exec/exportExec';
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
