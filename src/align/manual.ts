/**
 * 手动校时(P8 入口,P10 起为兼容 re-export 壳)——形状与合并逻辑上浮至
 * `src/ir/audio/timing.ts`(契约层;② 编译直接消费 `opts.timing` 注释)。
 */
export {
  applyManualTiming,
  applyTimingCorrections,
  type WordTimingCorrection,
} from '../ir/audio/timing';
