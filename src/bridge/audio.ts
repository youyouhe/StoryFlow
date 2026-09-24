/**
 * ②音频桥(P2-② 边界桩)——签名锁定,实装归 P2-② 实例。
 * 接口清单:docs/storyflow-ir-p2.md §2.2(TTS/SFX 任务队列 + mixSegment 参数)。
 */
import type { AudioMixPlan } from '../ir/audio/types';
import type { ProSegmentCut } from '../../services/videoExport';
import type {
  BgmCall, BgmCallRuntime, MixCallRuntime, SfxCall, TtsCall, TtsCallRuntime,
} from './types';

export const mapAudioPlanToTtsQueue = (
  plan: AudioMixPlan,
  rt: TtsCallRuntime,
): TtsCall[] => {
  void plan;
  void rt;
  throw new Error('P2-② not implemented — 接口清单见 docs/storyflow-ir-p2.md §2.2');
};

export const mapAudioPlanToSfxQueue = (plan: AudioMixPlan): SfxCall[] => {
  void plan;
  throw new Error('P2-② not implemented — 接口清单见 docs/storyflow-ir-p2.md §2.2');
};

export const mapAudioPlanToBgmQueue = (
  plan: AudioMixPlan,
  rt: BgmCallRuntime,
): BgmCall[] => {
  void plan;
  void rt;
  throw new Error('P2-② not implemented — 接口清单见 docs/storyflow-ir-p2.md §2.2');
};

export const mapMixToProSegmentCuts = (
  plan: AudioMixPlan,
  rt: MixCallRuntime,
): ProSegmentCut[] => {
  void plan;
  void rt;
  throw new Error('P2-② not implemented — 接口清单见 docs/storyflow-ir-p2.md §2.2');
};
