# localsend_recv.py — LocalSend v2.2 接收端 (最小可用)
# 让局域网内的手机/电脑用官方 LocalSend App 直接往本工具发素材
# 文件落盘到指定资产文件夹 → StoryFlow 扫描自动收编入资产库
#
# 协议: UDP 多播发现 (224.0.0.167:53317) + 明文 HTTP API (:53317)
# 端点: /api/localsend/v2/{register, prepare-upload, upload, cancel, info}
# 附加: GET /status (供 StoryFlow 前端轮询, 带 CORS)
# 参考: https://github.com/localsend/protocol/blob/main/README.md
#
# 用法:
#   python3 localsend_recv.py <资产文件夹> [设备别名]
#   LOCALSEND_IF_IP=<本机网卡IP> python3 localsend_recv.py <文件夹>   # 多网卡时
import os, sys, json, uuid, socket, struct, threading, time, logging
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

# Windows 控制台默认 GBK, logging 走 stderr 会把中文写成乱码 (重定向到文件/管道时尤其明显)
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
try: sys.stderr.reconfigure(encoding='utf-8')
except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
SAVE_DIR = os.environ.get('LOCALSEND_SAVE_DIR', '') or os.path.join(HERE, 'render_uploads')
os.makedirs(SAVE_DIR, exist_ok=True)

MULTICAST_GROUP = '224.0.0.167'
MULTICAST_GROUP_V6 = 'ff12::fd3a:e420'
PORT = 53317
PROTOCOL_VERSION = '2.2'
ALIAS = os.environ.get('LOCALSEND_ALIAS', 'StoryFlow 资产库')
DEVICE_MODEL = 'Server'
DEVICE_TYPE = 'server'

logger = logging.getLogger('localsend')
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format='[localsend] %(message)s')

# 设备指纹: 进程级随机字符串 (明文模式下不需要证书)
FINGERPRINT = uuid.uuid4().hex

# === 会话/Token 管理 ===
_sessions = {}            # sessionId -> {files: {fileId: {token, dto, done}}, sender_ip, ts}
_sessions_lock = threading.Lock()
_active_session = None    # 同一时间只允许一个活跃会话 (协议要求, 否则 409)

# === 多播出口网卡 IP (None=自动探测; 指定后强制从该网卡发) ===
# 优先级: 环境变量 LOCALSEND_IF_IP (设置页可配) > 自动探测 > OS 默认路由。
# 电脑连手机热点时, 应设为电脑在该热点的 IP (如 192.168.132.187)
MULTICAST_IF_IP = os.environ.get('LOCALSEND_IF_IP', '').strip() or None


def set_multicast_interface(ip):
    """指定多播 announce 从哪个本机 IP(网卡)发出。供 render_server 启动时探测设置。"""
    global MULTICAST_IF_IP
    MULTICAST_IF_IP = ip


def _detect_outbound_ip():
    """探测局域网出口 IP。用 psutil 枚举网卡 (hostname 解析在部分 Linux 上只有
    127.0.1.1, 不可靠), 按接口名+网段排除 VPN/WSL/Docker 虚拟网卡, 优先物理网卡。
    兜底: connect('8.8.8.8') 探测默认路由 (VPN 全局接管时会选错, 仅最后手段)."""
    # (ip, ifname) 候选; psutil 不可用时退回 getaddrinfo
    candidates = []
    try:
        import psutil
        for ifname, addrs in psutil.net_if_addrs().items():
            ln = ifname.lower()
            # 虚拟/隧道接口直接整卡排除 (名字特征)
            if any(k in ln for k in ('tun', 'wg', 'tap', 'docker', 'br-', 'veth',
                                     'vmnet', 'vethernet', 'hytun', 'utun')):
                continue
            for a in addrs:
                if a.family != socket.AF_INET:
                    continue
                ip = a.address
                if ip.startswith('127.') or ip.startswith('169.254.'):
                    continue
                candidates.append((ip, ifname))
    except Exception:
        pass
    if not candidates:
        try:
            for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
                ip = info[4][0]
                if ip.startswith('127.') or ip.startswith('169.254.'):
                    continue
                candidates.append((ip, ''))
        except Exception:
            pass
    # 去重
    candidates = list(dict.fromkeys(candidates))
    # 网段打分: 偏好 192.168.x (家庭/热点 LAN), 降权 172.x (WSL/Docker)、10.x、CGNAT
    def score(item):
        ip = item[0]
        if ip.startswith('192.168.'): return 0      # 家庭/热点 LAN, 最优先
        if ip.startswith('172.'):                   # WSL/Docker 虚拟, 降权
            return 10
        if ip.startswith('10.'):                    # 10.x (含 WireGuard), 降权
            return 20
        if ip.startswith('100.64.') or ip.startswith('100.1'):  # CGNAT/VPN (Tailscale 等), 降权
            return 25
        return 15
    candidates.sort(key=score)
    if candidates:
        return candidates[0][0]
    # 兜底: 用 connect 探测 (默认路由; 有全局 VPN 时会选到 VPN IP)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None

# === 本次运行接收历史 (供接收页面展示; start_server 时清空) ===
_received_log = []        # [{fileName, size, fileType, sender_ip, time, saved_path}]
_received_lock = threading.Lock()

# === 收件回调 (render_server 注册, 用于自动感知) ===
_on_file_received = None  # callable(path) -> None


def set_on_file_received(cb):
    """注册收件完成回调. cb(absolute_path). 返回 None 则清除."""
    global _on_file_received
    _on_file_received = cb


def _log_received(fname, size, ftype, sender_ip, saved_path):
    with _received_lock:
        _received_log.append({
            'fileName': fname, 'size': size, 'fileType': ftype,
            'sender_ip': sender_ip, 'time': time.time(), 'saved_path': saved_path,
        })
    cb = _on_file_received
    if cb:
        try:
            cb(saved_path)
        except Exception as e:
            logger.warning('on_file_received 回调异常: %s', e)


def _device_info():
    return {
        'alias': ALIAS,
        'version': PROTOCOL_VERSION,
        'deviceModel': DEVICE_MODEL,
        'deviceType': DEVICE_TYPE,
        'fingerprint': FINGERPRINT,
        'download': False,
    }


def _announce_payload():
    info = _device_info()
    info['port'] = PORT
    info['protocol'] = 'http'
    info['announce'] = True
    return info


# ============================================================ UDP 多播
class MulticastAnnouncer:
    """启动时 + 周期性向 224.0.0.167:53317 发 announce, 让手机发现本设备"""

    def __init__(self):
        self._sock = None
        self._stop = threading.Event()
        self._if_ip = MULTICAST_IF_IP or _detect_outbound_ip()

    def start(self):
        try:
            self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
            self._sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 1)
            # 关键: 显式指定多播出口网卡, 否则 Windows 在多网卡(WSL/WLAN/蓝牙)时会选错
            if self._if_ip:
                try:
                    self._sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF,
                                          socket.inet_aton(self._if_ip))
                    logger.info('多播出口网卡: %s', self._if_ip)
                except Exception as e:
                    logger.warning('设置多播出口网卡失败 %s: %s', self._if_ip, e)
        except Exception as e:
            logger.warning('多播 socket 创建失败: %s', e)
            return
        t = threading.Thread(target=self._loop, daemon=True, name='ls-announce')
        t.start()
        logger.info('多播公告已启动 (组 %s:%d, 出口 %s)', MULTICAST_GROUP, PORT, self._if_ip or 'auto')

    def _loop(self):
        # 启动时连发 3 次 (100ms/500ms/2000ms 间隔, 模仿官方)
        for delay in (0.1, 0.5, 2.0):
            self._send()
            time.sleep(delay)
        # 之后每 30 秒重发一次, 保持可被发现
        while not self._stop.wait(30):
            self._send()

    def _send(self):
        try:
            payload = json.dumps(_announce_payload()).encode('utf-8')
            self._sock.sendto(payload, (MULTICAST_GROUP, PORT))
        except Exception as e:
            logger.debug('announce 发送: %s', e)

    def stop(self):
        self._stop.set()


class MulticastListener:
    """监听其他设备的 announce, 记录到已知设备表 (供调试/将来主动 register 用)"""

    def __init__(self):
        self._sock = None
        self._stop = threading.Event()
        self._if_ip = MULTICAST_IF_IP or _detect_outbound_ip()

    def start(self):
        try:
            self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
            self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            # 关键修复: Windows 上 UDP 53317 bind 常报 10013 (端口保留/Hyper-V 占用)
            # 多播监听只是"发现别人"的辅助功能, 失败不应影响主流程 (HTTP 接收+announce 才是核心)
            try:
                self._sock.bind(('', PORT))
            except OSError as e:
                logger.info('多播监听 bind %d 跳过 (不影响接收): %s', PORT, e)
                self._sock = None
                return
            # 绑定到指定出口网卡的多播组, 避免收到其他网卡(WSL)的噪声
            if self._if_ip:
                mreq = struct.pack('4s4s', socket.inet_aton(MULTICAST_GROUP), socket.inet_aton(self._if_ip))
            else:
                mreq = struct.pack('4sL', socket.inet_aton(MULTICAST_GROUP), socket.INADDR_ANY)
            try:
                self._sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
            except Exception as e:
                logger.info('多播组成员加入失败 (不影响接收): %s', e)
        except Exception as e:
            logger.warning('多播监听启动失败: %s', e)
            self._sock = None
            return
        t = threading.Thread(target=self._loop, daemon=True, name='ls-listen')
        t.start()
        logger.info('多播监听已启动 (出口 %s)', self._if_ip or 'auto')

    def _loop(self):
        if not self._sock:
            return
        while not self._stop.wait(0.2):
            try:
                self._sock.settimeout(0.5)
                data, addr = self._sock.recvfrom(8192)
                msg = json.loads(data.decode('utf-8', 'ignore'))
                if msg.get('announce'):
                    logger.info('发现设备: %s @ %s (type=%s)', msg.get('alias'), addr[0], msg.get('deviceType'))
            except socket.timeout:
                continue
            except Exception:
                continue

    def stop(self):
        self._stop.set()


# ============================================================ HTTP 接收
class LSHandler(BaseHTTPRequestHandler):
    # 静音默认日志 (太多)
    def log_message(self, fmt, *args):
        logger.debug('%s - %s', self.address_string(), fmt % args)

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        # 只读 GET 端点供 StoryFlow 前端轮询 (跨源); 上传端点由 LocalSend 原生 App
        # 调用, 不受 CORS 约束, 加此头无副作用。
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _empty(self, code):
        self.send_response(code)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/api/localsend/v2/info'):
            return self._json(200, _device_info())
        if self.path.split('?')[0] == '/status':
            return self._json(200, status())
        return self._empty(404)

    def do_POST(self):
        path = self.path.split('?')[0]
        if path == '/api/localsend/v2/register':
            return self._json(200, _device_info())
        if path == '/api/localsend/v2/prepare-upload':
            return self._handle_prepare_upload()
        if path == '/api/localsend/v2/upload':
            return self._handle_upload()
        if path == '/api/localsend/v2/cancel':
            return self._handle_cancel()
        return self._empty(404)

    # ---------- prepare-upload ----------
    def _handle_prepare_upload(self):
        global _active_session
        length = int(self.headers.get('Content-Length', 0))
        raw = self._read_body(length)
        try:
            data = json.loads(raw.decode('utf-8') or '{}')
        except Exception:
            return self._empty(400)

        files = data.get('files', {})
        if not files:
            return self._empty(204)  # 无文件

        sender_ip = self.client_address[0]
        with _sessions_lock:
            # 若已有活跃会话且不是同一发送方 → 409
            if _active_session and _active_session != sender_ip:
                # 检查是否过期 (>10 分钟视为失效)
                sess = _sessions.get(_active_session)
                if sess and (time.time() - sess['ts']) < 600:
                    return self._empty(409)
            session_id = str(uuid.uuid4())
            tokens = {}
            session = {'files': {}, 'sender_ip': sender_ip, 'ts': time.time(),
                        'info': data.get('info', {})}
            for fid, fdto in files.items():
                token = str(uuid.uuid4())
                session['files'][fid] = {'token': token, 'dto': fdto, 'done': False}
                tokens[fid] = token
            _sessions[session_id] = session
            _active_session = sender_ip

        logger.info('prepare-upload: %d 个文件来自 %s, session=%s',
                    len(files), sender_ip, session_id[:8])
        for fid, fdto in files.items():
            logger.info('  - %s (%s, %d bytes)',
                        fdto.get('fileName'), fdto.get('fileType'), fdto.get('size', 0))
        return self._json(200, {'sessionId': session_id, 'files': tokens})

    # ---------- upload ----------
    def _handle_upload(self):
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(self.path).query)
        session_id = (q.get('sessionId') or [None])[0]
        file_id = (q.get('fileId') or [None])[0]
        token = (q.get('token') or [None])[0]

        with _sessions_lock:
            session = _sessions.get(session_id)
            if not session:
                return self._empty(403)
            # 发送方 IP 必须与会话一致
            if session['sender_ip'] != self.client_address[0]:
                return self._empty(403)
            fentry = session['files'].get(file_id)
            if not fentry or fentry['token'] != token:
                return self._empty(403)
            fdto = fentry['dto']

        # 流式写文件 (避免大视频占内存)
        fname = self._safe_name(fdto.get('fileName', f'{file_id}.bin'))
        dst = os.path.join(SAVE_DIR, fname)
        # 同名冲突自动加序号
        dst = self._dedup_path(dst)
        expected_sha = fdto.get('sha256')

        import hashlib
        h = hashlib.sha256() if expected_sha else None
        try:
            with open(dst, 'wb') as f:
                remaining = int(self.headers.get('Content-Length', 0))
                while remaining > 0:
                    chunk = self.rfile.read(min(65536, remaining))
                    if not chunk:
                        break
                    f.write(chunk)
                    remaining -= len(chunk)
                    if h:
                        h.update(chunk)
        except Exception as e:
            logger.error('写文件失败 %s: %s', dst, e)
            return self._empty(500)

        # SHA256 校验 (可选)
        if expected_sha and h and h.hexdigest() != expected_sha:
            try: os.unlink(dst)
            except: pass
            logger.warning('SHA256 校验失败: %s', fname)
            return self._empty(422)

        with _sessions_lock:
            fentry['done'] = True
        _log_received(fname, fdto.get('size', 0), fdto.get('fileType', ''),
                      self.client_address[0], dst)
        logger.info('upload 完成: %s -> %s', fname, os.path.relpath(dst, HERE))

        # 若该会话所有文件都完成, 释放活跃锁
        with _sessions_lock:
            session = _sessions.get(session_id)
            if session and all(f['done'] for f in session['files'].values()):
                _active_session = None
                logger.info('会话 %s 全部完成', session_id[:8])
        return self._empty(200)

    # ---------- cancel ----------
    def _handle_cancel(self):
        global _active_session
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(self.path).query)
        session_id = (q.get('sessionId') or [None])[0]
        with _sessions_lock:
            if session_id in _sessions:
                _sessions.pop(session_id, None)
                _active_session = None
                logger.info('会话 %s 已取消', (session_id or '')[:8])
        return self._empty(200)

    # ---------- helpers ----------
    def _read_body(self, length):
        return self.rfile.read(length) if length else b''

    @staticmethod
    def _safe_name(name):
        # 防路径穿越
        name = os.path.basename(name)
        if not name:
            name = 'recv.bin'
        return name

    @staticmethod
    def _dedup_path(path):
        if not os.path.exists(path):
            return path
        base, ext = os.path.splitext(path)
        i = 1
        while os.path.exists(f'{base} ({i}){ext}'):
            i += 1
        return f'{base} ({i}){ext}'


# ============================================================ 启动/集成
_announcer = None
_listener = None
_http = None


def start_server(save_dir=None, port=PORT, alias=ALIAS, threaded=True):
    """启动 LocalSend 接收端 (UDP 多播 + HTTP), 返回是否成功。
    可在 render_server 启动时调用, 文件落 save_dir (默认 render_uploads/)"""
    global SAVE_DIR, PORT, ALIAS, _announcer, _listener, _http
    # 若已在运行, 直接返回成功 (避免重复启动占端口)
    if _http is not None:
        return True
    if save_dir:
        SAVE_DIR = save_dir
        os.makedirs(SAVE_DIR, exist_ok=True)
    PORT = port
    ALIAS = alias
    # 新会话: 清空上次接收历史
    with _received_lock:
        _received_log.clear()
    with _sessions_lock:
        _sessions.clear()
        _active_session = None
    # 探测多播出口 IP (电脑连手机热点时=该热点的本机 IP), 让 announce 发到正确网段
    if not MULTICAST_IF_IP:
        detected = _detect_outbound_ip()
        if detected:
            globals()['MULTICAST_IF_IP'] = detected

    # HTTP 接收服务器
    try:
        server_cls = ThreadingHTTPServer if threaded else type(
            'Srv', (ThreadingHTTPServer,), {'daemon_threads': True})
        _http = ThreadingHTTPServer(('0.0.0.0', PORT), LSHandler)
        _http.daemon_threads = True
    except OSError as e:
        logger.error('HTTP bind %d 失败 (端口被占? LocalSend 官方/其他进程?): %s', PORT, e)
        return False

    threading.Thread(target=_http.serve_forever, daemon=True, name='ls-http').start()
    logger.info('HTTP 接收端 @ 0.0.0.0:%d', PORT)

    # UDP 多播: announce (让自己被发现)
    _announcer = MulticastAnnouncer()
    _announcer.start()

    # UDP 多播: listen (发现别人, 供调试)
    _listener = MulticastListener()
    _listener.start()

    return True


def status():
    """供前端/API 查询接收端状态"""
    with _sessions_lock:
        active = _active_session
        sess = _sessions.get(active) if active else None
        # 进行中的会话文件详情 (供接收页面实时渲染)
        pending = []
        if sess:
            for fid, f in sess['files'].items():
                fdto = f.get('dto', {})
                pending.append({
                    'fileName': fdto.get('fileName', fid),
                    'size': fdto.get('size', 0),
                    'fileType': fdto.get('fileType', ''),
                    'done': f.get('done', False),
                })
    with _received_lock:
        received = list(_received_log)
    # 探测当前出口 IP 供前端展示 (手机该连的地址)
    out_ip = MULTICAST_IF_IP or _detect_outbound_ip()
    return {
        'running': _http is not None,
        'alias': ALIAS,
        'port': PORT,
        'save_dir': SAVE_DIR,
        'fingerprint': FINGERPRINT[:8],
        'active_sender': active,
        'pending_files': sum(1 for f in pending if not f['done']),
        'pending': pending,
        'received': received,
        'received_count': len(received),
        'my_ip': out_ip,
    }


def stop_server():
    """停止 LocalSend 接收端 (HTTP 监听 + 多播线程), 返回本次接收历史。
    可与 start_server() 配合实现按需开启/关闭。"""
    global _http, _announcer, _listener, _active_session
    if _http is None:
        # 已停止, 仍返回历史 (可能为空)
        with _received_lock:
            return list(_received_log)
    try:
        _http.shutdown()
    except Exception:
        pass
    try:
        _http.server_close()
    except Exception:
        pass
    if _announcer:
        _announcer.stop()
    if _listener:
        _listener.stop()
    with _sessions_lock:
        _sessions.clear()
        _active_session = None
    _http = None
    _announcer = None
    _listener = None
    logger.info('LocalSend 接收端已停止')
    with _received_lock:
        return list(_received_log)


if __name__ == '__main__':
    # 用法: python3 localsend_recv.py <资产文件夹> [别名]
    #       环境变量 LOCALSEND_IF_IP 可强制多播出口网卡 (多网卡/热点场景)
    if len(sys.argv) >= 2:
        SAVE_DIR = sys.argv[1]
    if len(sys.argv) >= 3:
        ALIAS = sys.argv[2]
    print('=== LocalSend 接收端 (StoryFlow 资产投递) ===')
    print('保存目录:', SAVE_DIR)
    print('设备名:', ALIAS, '| 端口:', PORT, '| 指纹:', FINGERPRINT[:8])
    print('手机安装 LocalSend App (同一 Wi-Fi) → 搜到本设备 → 发送即入资产文件夹')
    print('前端状态页: http://<本机IP>:%d/status' % PORT)
    if start_server(save_dir=SAVE_DIR, alias=ALIAS):
        try:
            while True:
                time.sleep(5)
                s = status()
                if s['active_sender']:
                    print(f"[状态] {s['active_sender']} 发送中, 待收 {s['pending_files']} 个文件")
        except KeyboardInterrupt:
            print('\n退出')
    else:
        print('启动失败, 见日志')
