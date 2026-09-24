import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { StoryFlowIR, TtsClip } from '../src/ir/types';
import { parseStoryFlowIR } from '../src/ir/schema';
import { compileAudioPlan } from '../src/ir/audio/compile';
import { executeAudioPlan } from '../src/exec/audioExec';
import type { AudioExecDeps, AudioExecPorts } from '../src/exec/types';

const examplePath = fileURLToPath(new URL('../docs/storyflow-ir-example.json', import.meta.url));
const example = (): StoryFlowIR =>
  parseStoryFlowIR(JSON.parse(readFileSync(examplePath, 'utf-8')));
const mutated = (fn: (ir: StoryFlowIR) => void): StoryFlowIR => {
  const ir = JSON.parse(JSON.stringify(example())) as StoryFlowIR;
  fn(ir);
  return ir;
};

const mockAudioPorts = (over: Partial<AudioExecPorts> = {}) => {
  const calls: string[] = [];
  const ports: AudioExecPorts = {
    synthesizeSpeech: async (_key, input) => {
      calls.push(`tts:${input.slice(0, 4)}`);
      return new Blob([input]);
    },
    concatWavs: async parts => {
      calls.push(`concat:${parts.length}`);
      return new Blob(['joined']);
    },
    wavDuration: () => {
      calls.push('probe');
      return 3.5;
    },
    resolveSfx: async name => {
      calls.push(`sfx:${name}`);
      return name === 'shutter' ? { name, missing: true } : { name, url: `sfx://${name}.wav` };
    },
    requestMusic: async () => {
      calls.push('bgm-submit');
      return { requestId: 'req-1' };
    },
    pollMusic: async () => {
      calls.push('bgm-poll');
      return { status: 'succeeded' as const, audioUrl: 'bgm://1.m4a' };
    },
    ...over,
  };
  return { ports, calls };
};

const baseDeps = (ports: AudioExecPorts): AudioExecDeps => ({
  ports,
  ttsApiKey: 'tts-k',
  falKey: 'fal-k',
});

describe('executeAudioPlan — TTS 合成/拼杆/探活', () => {
  it('逐 part 合成、多 part 拼杆、探活进 measurements(② reflow 回填输入)', async () => {
    const plan = compileAudioPlan(example());
    const { ports, calls } = mockAudioPorts();
    const result = await executeAudioPlan(plan, baseDeps(ports));

    expect(calls.filter(c => c.startsWith('tts:'))).toHaveLength(2); // 2 台词 × 各 1 part
    expect(result.clipBlobs['aud-tts-001']).toBeInstanceOf(Blob);
    expect(result.measurements).toEqual({ 'aud-tts-001': 3.5, 'aud-tts-002': 3.5 });
    expect(calls).toContain('probe');
  });

  it('long lines fan out per part and join with concatWavs', async () => {
    const plan = compileAudioPlan(mutated(ir => {
      const clip = ir.audio.find(c => c.id === 'aud-tts-001') as TtsClip;
      clip.text = '好。'.repeat(800);
    }));
    const { ports, calls } = mockAudioPorts();
    const result = await executeAudioPlan(plan, baseDeps(ports));
    expect(calls.some(c => c.startsWith('concat:'))).toBe(true);
    expect(result.clipBlobs['aud-tts-001']).toBeInstanceOf(Blob);
    expect(result.failures).toEqual([]);
  });
});

describe('executeAudioPlan — SFX 查表 + BGM 轮询', () => {
  it('resolves every sfx (missing 如实) and collects bgm urls', async () => {
    const plan = compileAudioPlan(example());
    const { ports, calls } = mockAudioPorts();
    const result = await executeAudioPlan(plan, baseDeps(ports));

    expect(result.sfxResolutions['aud-sfx-001']).toEqual({ name: 'ding', url: 'sfx://ding.wav' });
    expect(result.sfxResolutions['aud-sfx-002']).toEqual({ name: 'shutter', missing: true });
    expect(calls).toContain('bgm-submit');
    expect(calls).toContain('bgm-poll');
    expect(result.bgmUrls['aud-bgm-001']).toBe('bgm://1.m4a');
    expect(result.failures).toEqual([]);
  });

  it('单 clip 失败不中断其余(P2 失败=新调用)', async () => {
    const plan = compileAudioPlan(example());
    const { ports } = mockAudioPorts({
      synthesizeSpeech: async (_key, input) => {
        if (input.startsWith('拍一张')) throw new Error('TTS 网络抖动');
        return new Blob([input]);
      },
    });
    const result = await executeAudioPlan(plan, baseDeps(ports));
    expect(result.failures).toEqual([{ clipId: 'aud-tts-001', error: 'TTS 网络抖动' }]);
    expect(result.clipBlobs['aud-tts-002']).toBeInstanceOf(Blob); // 其余照常
    expect(result.bgmUrls['aud-bgm-001']).toBe('bgm://1.m4a');
  });
});
