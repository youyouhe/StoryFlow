/**
 * ②音频编译器入口(P1-② 边界桩)——签名锁定,实现归 ② 实例。
 *
 * 职责(任务书):TTS 词级锚定→时间轴 + 三轨混音计划。词锚基文本/分词器/
 * 时长拟合用 `src/ir/shared.ts` 的缝合原语;混音形状 = AudioMixPlan(增益常量
 * 钉死在 audio/types.ts,对照 services/videoExport.ts:230-238)。
 */
import type { StoryFlowIR } from '../types';
import type { AudioMixPlan, AudioCompileOptions } from './types';

export const compileAudioPlan = (
  ir: StoryFlowIR,
  opts: AudioCompileOptions = {},
): AudioMixPlan => {
  void ir;
  void opts;
  throw new Error('P1-② not implemented — 边界契约见 docs/storyflow-ir-p1.md §2.2');
};
