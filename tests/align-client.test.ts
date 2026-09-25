import { describe, it, expect } from 'vitest';

import { createAlignClient } from '../src/align/client';
import { splitAnchorWords } from '../src/ir/shared';

const LINE = '拍一张证件照,要赶九点的火车。'; // 13 token(标点不产 token)

const mockFetch = (body: unknown, init: { ok?: boolean; status?: number } = {}) => {
  const calls: { url: string; form: FormData }[] = [];
  const fetchFn = (async (url: RequestInfo | URL, opts?: RequestInit) => {
    calls.push({ url: String(url), form: opts?.body as FormData });
    return new Response(
      init.ok === false ? 'boom' : JSON.stringify(body),
      { status: init.status ?? (init.ok === false ? 500 : 200) },
    );
  }) as typeof fetch;
  return { fetchFn, calls };
};

describe('createAlignClient — 强制对齐 HTTP 契约', () => {
  it('POST multipart(audio blob + text),响应映射为 AlignmentTake', async () => {
    const tokens = splitAnchorWords(LINE).map((text, i) => ({
      text, startMs: i * 100, endMs: i * 100 + 90, confidence: 0.9,
    }));
    const { fetchFn, calls } = mockFetch({ durationMs: 3400, tokens });
    const alignTake = createAlignClient({ endpoint: 'http://align.test/', fetchFn });

    const blob = new Blob(['wav-bytes']);
    const take = await alignTake(blob, LINE);

    expect(calls[0].url).toBe('http://align.test/align');
    expect(calls[0].form.get('text')).toBe(LINE);
    expect(calls[0].form.get('audio')).toBeInstanceOf(Blob);
    expect(take.text).toBe(LINE); // 新鲜度指纹 = 请求文本
    expect(take.clipId).toBe(''); // runner 权威盖章(P5 口径)
    expect(take.durationMs).toBe(3400);
    expect(take.tokens).toHaveLength(13);
    expect(take.tokens[10]).toEqual({ tokenIndex: 10, text: '的', startMs: 1000, endMs: 1090, confidence: 0.9 });
  });

  it('token 数不符即抛(逐位对齐契约,拒绝而非钳制)', async () => {
    const { fetchFn } = mockFetch({
      durationMs: 3400,
      tokens: [{ startMs: 0, endMs: 100 }], // 1 ≠ 13
    });
    await expect(createAlignClient({ endpoint: 'http://a.test', fetchFn })(new Blob(['x']), LINE))
      .rejects.toThrow(/token 数不符/);
  });

  it('HTTP 错与非法响应即抛', async () => {
    const { fetchFn: fail500 } = mockFetch(null, { ok: false, status: 503 });
    await expect(createAlignClient({ endpoint: 'http://a.test', fetchFn: fail500 })(new Blob(['x']), LINE))
      .rejects.toThrow(/HTTP 503/);
    const { fetchFn: badBody } = mockFetch({ nope: true });
    await expect(createAlignClient({ endpoint: 'http://a.test', fetchFn: badBody })(new Blob(['x']), LINE))
      .rejects.toThrow(/响应非法/);
  });
});
