/**
 * 视频生成成本预估 —— services/minimaxService.ts:80-105
 * (videoPrice / estimateH3Cost)的**整数分镜像**。
 *
 * 为什么镜像而不是 import:① `src/ir/` 树不引 services/(边界总则,
 * docs/storyflow-ir-p1.md §1);② 规则三「金额分整数」——源实现以元浮点计价
 * (estimateH3Cost 返回 Math.round(x*100)/100 的元),`0.29 × 100 = 28.99…`
 * 的浮点尘会在转分时踩坑。镜像表直接以分存储,全程整数运算,末值即分。
 *
 * 价目对应(官方 CN 刊例,services/minimaxService.ts:61-68 注释):
 *   H3      :输出 2K ¥0.80/s、其余 ¥0.50/s;输入参考视频同价;
 *            参考图前 5 张免费、之后 ¥0.20/张
 *   H3-Max  :输出 480P ¥0.33/s、其余 ¥0.50/s;输入视频 480P ¥0.37/s、
 *            其余 ¥0.97/s;参考图前 2 张免费、之后 ¥0.50/张
 * (H3 480P 为 API 收单但未刊价——与源实现一致落入非 Max 档。)
 */

export interface VideoPriceBookFen {
  /** 输出价(分/秒)。 */
  outputPerSecFen: number;
  /** 输入参考视频价(分/秒)。 */
  inputVideoPerSecFen: number;
  /** 参考图免费张数。 */
  imageFree: number;
  /** 超出免费额后的单价(分/张)。 */
  imageEachFen: number;
}

export const videoPriceFen = (model: string | undefined, resolution: string): VideoPriceBookFen => {
  if (model?.includes('Max')) {
    return {
      outputPerSecFen: resolution === '480P' ? 33 : 50,
      inputVideoPerSecFen: resolution === '480P' ? 37 : 97,
      imageFree: 2,
      imageEachFen: 50,
    };
  }
  const outputPerSecFen = resolution === '2K' ? 80 : 50;
  return { outputPerSecFen, inputVideoPerSecFen: outputPerSecFen, imageFree: 5, imageEachFen: 20 };
};

/** 整数分成本 = 输出 + 输入参考视频 + 超额参考图。输入全为整数(秒/张),
 *  输出即为分,无二次取整。与 estimateH3Cost 的关系:
 *  estimateVideoCostFen(p) === Math.round(estimateH3Cost(p) * 100)(元浮点
 *  四舍五入到分),但本函数无浮点中间态。 */
export const estimateVideoCostFen = (p: {
  outputSeconds: number;
  imageCount: number;
  resolution: string;
  model?: string;
  /** 参考视频(R2V 白模)输入秒数;T2V/I2V 为 0。 */
  videoSeconds?: number;
}): number => {
  const book = videoPriceFen(p.model, p.resolution);
  const output = p.outputSeconds * book.outputPerSecFen;
  const inputVideo = (p.videoSeconds ?? 0) * book.inputVideoPerSecFen;
  const extraImages = Math.max(0, p.imageCount - book.imageFree) * book.imageEachFen;
  return output + inputVideo + extraImages;
};
