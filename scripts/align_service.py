#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WhisperX 类对齐服务(强制对齐 HTTP 契约,docs/storyflow-ir-p8.md §2)。

    POST /align   multipart/form-data: audio=<wav>, text=<锚基文本全文>
      → 200 {"durationMs": int, "tokens": [{"text","startMs","endMs","confidence"}, …]}

tokens 与 `splitAnchorWords(text)` 逐位对齐(N:M 归并在服务侧消化:同窗多
token = 共享窗)。token 数永远等于分词数——客户端(src/align/client.ts)按
数校验,拒绝而非钳制。

GPU 纪律(派单原文):必须 CUDA_DEVICE_ORDER=PCI_BUS_ID 且
CUDA_VISIBLE_DEVICES=3。本机(ThinkPad T430)无 NVIDIA GPU——当前对齐后端
是 CPU 声学对齐(VAD + 能量谷约束,仅 numpy + stdlib),这两个变量照常钉在
进程环境最顶端:未来把 backend 换成 torch/WhisperX 时零改动即落 GPU 3
(按 PCI 总线序枚举,与 nvidia-smi 序号解耦)。禁碰 8950/8940 生产服务——
本服务默认绑 127.0.0.1:8788。

对齐算法(CPU,真声学证据):
  1. wav 解码(wave 模块,任意声道/位深 → 单声道 float);
  2. 帧能量(25ms 窗 / 10ms 步)→ 自适应 VAD(噪声底 P10 + 10dB 迟滞);
  3. 语音区合计时长内按 token 权重分配(汉字=1,拉丁/数字串=0.28×长度);
  4. 内部边界吸附到 ±120ms 内最深的能量谷(真谷判定:谷底低于两侧 ≥3dB);
  5. 置信度 = 谷吸附 + 局部 SNR + VAD 覆盖的综合;静音区词给低置信。
"""
import os

# ---- GPU 纪律(必须在任何框架 import 之前)---------------------------------
os.environ.setdefault('CUDA_DEVICE_ORDER', 'PCI_BUS_ID')  # 按 PCI 总线序枚举 GPU
os.environ.setdefault('CUDA_VISIBLE_DEVICES', '3')        # 钉 GPU 3(派单纪律)

import argparse
import io
import json
import sys
import threading
import unicodedata
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

DEFAULT_PORT = 8788
FRAME_MS = 25
HOP_MS = 10
SNAP_MS = 120          # 边界吸附搜索半径
VALLEY_DB = 3.0        # 真谷判定深度
SILENCE_CONF = 0.15
HAN_RANGES = ((0x4E00, 0x9FFF), (0x3400, 0x4DBF), (0xF900, 0xFAFF),
              (0x20000, 0x2A6DF), (0x2A700, 0x2EBEF))


def is_han(ch: str) -> bool:
    cp = ord(ch)
    return any(lo <= cp <= hi for lo, hi in HAN_RANGES)


def split_anchor_words(text: str):
    """逐位镜像 src/ir/shared.ts splitAnchorWords:
    /\\p{Script=Han}|[\\p{Letter}\\p{Number}\\p{Mark}]+/gu —— 汉字单字成 token,
    连续字母/数字/组合符成串。分词数即契约 token 数。"""
    tokens, run = [], ''
    for ch in text:
        if is_han(ch):
            if run:
                tokens.append(run)
                run = ''
            tokens.append(ch)
        elif unicodedata.category(ch)[0] in ('L', 'N', 'M'):
            run += ch
        else:
            if run:
                tokens.append(run)
                run = ''
    if run:
        tokens.append(run)
    return tokens


def token_weight(token: str) -> float:
    """分配权重:汉字单字 = 1;拉丁/数字串 = 0.28×长度(音节经验比)。"""
    if len(token) == 1 and is_han(token):
        return 1.0
    return max(0.5, 0.28 * len(token))


def decode_wav(data: bytes):
    """任意 PCM wav → (float32 单声道, rate)。非 wav 直接抛(ValueError)。"""
    with wave.open(io.BytesIO(data), 'rb') as w:
        rate = w.getframerate()
        nch = w.getnchannels()
        width = w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width == 2:
        x = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
    elif width == 1:
        x = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif width == 4:
        x = np.frombuffer(raw, dtype='<i4').astype(np.float32) / 2147483648.0
    elif width == 3:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        x = ((b[:, 0].astype(np.int32)) |
             (b[:, 1].astype(np.int32) << 8) |
             (b[:, 2].astype(np.int32) << 16)).astype(np.float32)
        x = np.where(x >= 8388608, x - 16777216, x) / 8388608.0
    else:
        raise ValueError('unsupported sample width %d' % width)
    if nch > 1:
        x = x[: len(x) // nch * nch].reshape(-1, nch).mean(axis=1)
    return x.astype(np.float32), rate


def frame_energy_db(x: np.ndarray, rate: int):
    """(帧能量 dB, 帧中心时刻 ms)。25ms 汉宁窗 RMS。"""
    frame = max(1, int(rate * FRAME_MS / 1000))
    hop = max(1, int(rate * HOP_MS / 1000))
    if len(x) < frame:
        x = np.pad(x, (0, frame - len(x)))
    win = np.hanning(frame).astype(np.float32)
    n = 1 + (len(x) - frame) // hop
    idx = np.arange(frame)[None, :] + hop * np.arange(n)[:, None]
    rms = np.sqrt(np.mean((x[idx] * win[None, :]) ** 2, axis=1) + 1e-12)
    db = 20.0 * np.log10(rms + 1e-12)
    centers_ms = (np.arange(n) * hop + frame // 2) * 1000.0 / rate
    return db, centers_ms


def vad_speech_regions(db: np.ndarray, centers_ms: np.ndarray):
    """自适应迟滞 VAD → 语音区 [(startMs, endMs)](含首尾帧中心外扩半窗)。"""
    floor = float(np.percentile(db, 10))
    on_thr, off_thr = floor + 10.0, floor + 6.0
    speech, on = [], None
    for i, v in enumerate(db):
        if on is None and v >= on_thr:
            on = i
        elif on is not None and v < off_thr:
            speech.append((on, i))
            on = None
    if on is not None:
        speech.append((on, len(db) - 1))
    # 迟滞平滑:抹掉 <60ms 的碎段,<80ms 的碎缝
    merged = []
    for s, e in speech:
        if merged and (centers_ms[s] - centers_ms[merged[-1][1]]) < 80:
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))
    merged = [(s, e) for s, e in merged if centers_ms[e] - centers_ms[s] >= 60]
    half = FRAME_MS / 2.0
    return [(max(0.0, centers_ms[s] - half), centers_ms[e] + half) for s, e in merged]


def snap_to_valley(db: np.ndarray, centers_ms: np.ndarray, t_ms: float):
    """±SNAP_MS 内最深能量谷;真谷(低于两侧 ≥VALLEY_DB)→ (谷时刻, True)。"""
    i0 = int(np.searchsorted(centers_ms, t_ms - SNAP_MS))
    i1 = int(np.searchsorted(centers_ms, t_ms + SNAP_MS)) + 1
    seg = db[max(0, i0):min(len(db), i1)]
    if seg.size < 5:
        return t_ms, False
    k = int(np.argmin(seg)) + max(0, i0)
    lo, hi = max(0, k - 3), min(len(db) - 1, k + 3)
    if db[lo] - db[k] >= VALLEY_DB and db[hi] - db[k] >= VALLEY_DB:
        return float(centers_ms[k]), True
    return t_ms, False


def align(audio: bytes, text: str):
    x, rate = decode_wav(audio)
    duration_ms = int(round(len(x) / rate * 1000))
    tokens = split_anchor_words(text)
    if not tokens:
        raise ValueError('锚基文本无 token(分词为空)')
    db, centers_ms = frame_energy_db(x, rate)
    regions = vad_speech_regions(db, centers_ms)
    speech_ms = sum(e - s for s, e in regions)

    weights = np.array([token_weight(t) for t in tokens], dtype=np.float64)
    total_w = float(weights.sum())
    # 分配目标:有语音区 → 按语音时长等比;全静音 → 铺满全长(低置信兜底)
    span_ms = speech_ms if speech_ms > 50 else duration_ms
    raw_bounds = np.concatenate((
        [0.0], np.cumsum(weights / total_w) * span_ms))

    # raw_bounds 走「语音时间轴」,逐段映射回真实时间
    def speech_t_to_ms(t_speech: float) -> float:
        acc = 0.0
        for s, e in regions:
            seg_len = e - s
            if t_speech <= acc + seg_len or (s, e) == regions[-1]:
                return s + max(0.0, min(seg_len, t_speech - acc))
            acc += seg_len
        return duration_ms

    bounds = [speech_t_to_ms(float(b)) for b in raw_bounds]
    if regions:
        # 首词从语音区起点起(不吃前导静音);末词收在最后语音区尾(尾静音不摊词)
        bounds[0] = regions[0][0]
        bounds[-1] = max(regions[-1][1], bounds[-2] + 20.0)
    else:
        bounds[0], bounds[-1] = 0.0, float(duration_ms)
    # 内部共享边界只吸附一次(双侧各自吸附会产生重叠/裂缝)
    snapped_flags = [False] * len(bounds)
    for i in range(1, len(bounds) - 1):
        s2, snapped = snap_to_valley(db, centers_ms, bounds[i])
        if snapped:
            bounds[i], snapped_flags[i] = s2, True

    out, snapped_n = [], 0
    for i, tok in enumerate(tokens):
        s, e = bounds[i], bounds[i + 1]
        conf = 0.9 if snapped_flags[i] or (i + 1 < len(bounds) and snapped_flags[i + 1]) else 0.6
        snapped_n += 1 if snapped_flags[i] else 0
        if e - s < 20:
            mid = (s + e) / 2.0
            s, e = max(0.0, mid - 10), mid + 10
        # 局部 SNR / 静音覆盖 → 置信微调
        j0 = int(np.searchsorted(centers_ms, s))
        j1 = max(j0 + 1, int(np.searchsorted(centers_ms, e)))
        local = db[j0:j1]
        in_speech = any(s2 < e and s < e2 for s2, e2 in regions)
        if not in_speech:
            conf = SILENCE_CONF
        elif local.size:
            snr = float(np.percentile(local, 80) - np.percentile(db, 10))
            conf = min(0.97, max(conf, 0.55) + 0.05 * min(1.0, max(0.0, snr) / 30.0))
        out.append({
            'text': tok,
            'startMs': int(round(s)),
            'endMs': int(round(e)),
            'confidence': round(conf, 2),
        })
    return {
        'durationMs': duration_ms,
        'tokens': out,
        '_meta': {  # 调试附加;客户端只读 durationMs/tokens,多余键无害
            'engine': 'cpu-vad-valley/1.0',
            'rate': rate,
            'speechRegions': len(regions),
            'snappedBoundaries': snapped_n,
            'backend': os.environ.get('STORYFLOW_ALIGN_BACKEND', 'cpu'),
            'gpu': os.environ.get('CUDA_VISIBLE_DEVICES', ''),
        },
    }


class Handler(BaseHTTPRequestHandler):
    server_version = 'StoryFlowAlign/1.0'
    service_lock = threading.Lock()

    def log_message(self, fmt, *args):  # noqa: N802
        sys.stderr.write('[align] %s\n' % (fmt % args))

    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        if self.path in ('/health', '/'):
            self._json(200, {'ok': True, 'service': 'whisperx-class-align',
                             'backend': 'cpu-vad-valley/1.0',
                             'gpu': os.environ.get('CUDA_VISIBLE_DEVICES', '')})
        else:
            self._json(404, {'error': 'not found'})

    def do_POST(self):  # noqa: N802
        if self.path.rstrip('/') != '/align':
            self._json(404, {'error': 'not found'})
            return
        try:
            length = int(self.headers.get('Content-Length') or 0)
            if length <= 0:
                raise ValueError('empty body')
            import cgi
            form = cgi.FieldStorage(fp=self.rfile, headers=self.headers,
                                    environ={'REQUEST_METHOD': 'POST'})
            audio_field = form['audio'] if 'audio' in form else None
            text_field = form['text'] if 'text' in form else None
            if audio_field is None or text_field is None:
                raise ValueError('multipart 缺 audio/text 字段')
            # FieldStorage.__bool__ 在 3.10 显式抛 TypeError——只能按 None 判
            if audio_field.file:
                audio = audio_field.file.read()
            else:
                v = audio_field.value or b''
                audio = v if isinstance(v, bytes) else str(v).encode('utf-8', 'surrogateescape')
            text = text_field.value if hasattr(text_field, 'value') else ''
            if not audio:
                raise ValueError('audio 为空')
            with self.service_lock:  # numpy 帧计算非重入安全余量
                result = align(audio, text)
            self._json(200, result)
        except Exception as e:  # noqa: BLE001 契约:HTTP 错显式抛给客户端
            import traceback
            traceback.print_exc(file=sys.stderr)
            self._json(400, {'error': str(e)[:300]})


def main():
    ap = argparse.ArgumentParser(description='WhisperX 类对齐服务(CPU 声学对齐)')
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--port', type=int, default=DEFAULT_PORT)
    args = ap.parse_args()
    if args.port in (8940, 8950):
        sys.exit('拒绝绑定 %d——生产服务端口(纪律:勿动 8950/8940)' % args.port)
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print('[align] WhisperX-class align service on http://%s:%d  '
          '(CUDA_DEVICE_ORDER=%s CUDA_VISIBLE_DEVICES=%s backend=cpu-vad-valley)' % (
              args.host, args.port,
              os.environ.get('CUDA_DEVICE_ORDER', ''),
              os.environ.get('CUDA_VISIBLE_DEVICES', '')), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
