#!/usr/bin/env python3
"""server.py - Production Railway & Cloud Host for Insomniac (Weblox).

Features:
- Binds to 0.0.0.0:$PORT (configured via Railway environment variable).
- Multi-client session support (per-visitor .ROBLOSECURITY cookies via insomniac_sid).
- Optional server-wide fallback cookie via ROBLOSECURITY env var.
- Low-latency RFC 6455 WebSocket-to-UDP relay (/__udp) for Roblox RakNet networking.
- Authenticated proxy for *.roblox.com and gamejoin.roblox.com (/api/rbx/*) with auto CSRF handling.
- Full COOP/COEP/CORP headers required for SharedArrayBuffer & WebAssembly threading.
"""

import base64
import hashlib
import http.client
import json
import os
import socket
import ssl
import struct
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("PORT", 8770))
ROOT = Path(__file__).resolve().parent / "public"
if not ROOT.is_dir():
    ROOT = Path(__file__).resolve().parent

DEFAULT_COOKIE = (os.environ.get("ROBLOSECURITY") or os.environ.get("COOKIE") or "").strip()
CLIENT_UA = "Roblox/WinInet"
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

CSP = (
    "base-uri 'none'; default-src 'self'; object-src 'none'; "
    "frame-src 'self' https: http: blob: data:; "
    "connect-src 'self' http: https: ws: wss: blob: data:; "
    "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' 'unsafe-inline'; "
    "img-src 'self' https: http: blob: data:; "
    "media-src 'self' https: blob: data:; font-src 'self' blob: data:; "
    "style-src 'self' 'unsafe-inline'; "
    "frame-ancestors 'self'"
)

SECURITY_HEADERS = [
    ("content-security-policy", CSP),
    ("cross-origin-opener-policy", "same-origin"),
    ("cross-origin-embedder-policy", "require-corp"),
    ("cross-origin-resource-policy", "same-origin"),
]

MIME_MAP = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".wasm": "application/wasm",
    ".json": "application/json",
    ".html": "text/html; charset=utf-8",
    ".css": "text/css",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".otf": "font/otf",
    ".ttf": "font/ttf",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".xml": "application/xml",
    ".txt": "text/plain",
    ".lua": "text/plain",
    ".dds": "application/octet-stream",
    ".tex": "application/octet-stream",
    ".mesh": "application/octet-stream",
    ".rbxm": "application/octet-stream",
    ".pack": "application/octet-stream",
}

def content_type(path: Path) -> str:
    return MIME_MAP.get(path.suffix.lower(), "application/octet-stream")

# ---------------------------------------------------------------------------
# In-memory file cache for /engine/*
# ---------------------------------------------------------------------------
_FILE_CACHE: dict[str, bytes] = {}
_CACHE_LOCK = threading.Lock()

def read_cached(file: Path, cacheable: bool) -> bytes:
    if not cacheable:
        return file.read_bytes()
    key = str(file)
    with _CACHE_LOCK:
        data = _FILE_CACHE.get(key)
    if data is not None:
        return data
    data = file.read_bytes()
    if len(data) <= 30 * 1024 * 1024:
        with _CACHE_LOCK:
            _FILE_CACHE[key] = data
    return data

# ---------------------------------------------------------------------------
# Multi-client session manager
# ---------------------------------------------------------------------------
class ClientSession:
    def __init__(self, sid: str, cookie: str = ""):
        self.sid = sid
        self.cookie = cookie
        self.csrf = ""
        self.last_join_reply: dict | None = None
        self.last_join_script: dict | None = None
        self.last_seen = time.time()
        self.lock = threading.Lock()

_SESSIONS: dict[str, ClientSession] = {}
_SESSIONS_LOCK = threading.Lock()
_SSL_CTX = ssl.create_default_context()

def clean_cookie_value(raw: str) -> str:
    val = (raw or "").strip()
    if val.startswith(".ROBLOSECURITY="):
        val = val[len(".ROBLOSECURITY="):].split(";", 1)[0].strip()
    return val

def get_or_create_session(sid: str | None) -> tuple[ClientSession, bool]:
    with _SESSIONS_LOCK:
        if sid and sid in _SESSIONS:
            sess = _SESSIONS[sid]
            sess.last_seen = time.time()
            return sess, False
        new_sid = sid or uuid.uuid4().hex
        sess = ClientSession(new_sid, cookie=clean_cookie_value(DEFAULT_COOKIE))
        _SESSIONS[new_sid] = sess
        return sess, True

# ---------------------------------------------------------------------------
# Roblox API Proxy & HTTP Calling
# ---------------------------------------------------------------------------
def rbx_http_call(
    url: str,
    method: str = "GET",
    headers: dict | None = None,
    body: bytes | None = None,
    cookie: str = "",
    csrf: str = "",
    timeout: float = 20.0,
) -> tuple[int, str, dict[str, str], bytes, str]:
    """Perform an authenticated HTTPS request to Roblox with CSRF handling."""
    req_headers = {
        "User-Agent": BROWSER_UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    if headers:
        for k, v in headers.items():
            lk = k.lower()
            if lk not in ("host", "content-length", "cookie"):
                req_headers[k] = v

    if cookie:
        req_headers["Cookie"] = f".ROBLOSECURITY={cookie}"
    if csrf:
        req_headers["X-CSRF-TOKEN"] = csrf

    def send_one(h_dict: dict) -> tuple[int, str, dict[str, str], bytes]:
        req = urllib.request.Request(url, data=body, headers=h_dict, method=method)
        try:
            with urllib.request.urlopen(req, context=_SSL_CTX, timeout=timeout) as resp:
                r_headers = {k.lower(): v for k, v in resp.headers.items()}
                return resp.status, resp.geturl(), r_headers, resp.read()
        except urllib.error.HTTPError as e:
            e_headers = {k.lower(): v for k, v in e.headers.items()}
            return e.code, e.geturl(), e_headers, e.read()

    status, final_url, res_headers, data = send_one(req_headers)
    new_csrf = csrf

    # If CSRF validation failed (HTTP 403), grab new token and retry once
    if status == 403 and "x-csrf-token" in res_headers:
        new_csrf = res_headers["x-csrf-token"]
        req_headers["X-CSRF-TOKEN"] = new_csrf
        status, final_url, res_headers, data = send_one(req_headers)

    return status, final_url, res_headers, data, new_csrf

def perform_gamejoin(place_id: int, session: ClientSession) -> dict:
    """Negotiate a Roblox game join over persistent TLS."""
    if not session.cookie:
        raise RuntimeError("not authenticated: please paste your .ROBLOSECURITY cookie")

    conn = http.client.HTTPSConnection("gamejoin.roblox.com", 443, context=_SSL_CTX, timeout=12.0)
    conn.connect()
    try:
        sock = conn.sock
        if sock:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    except Exception:
        pass

    try:
        def post_once(job_id: str | None = None) -> dict:
            attempt_id = str(uuid.uuid4())
            session_id = str(uuid.uuid4())
            payload = {
                "placeId": place_id,
                "isTeleport": False,
                "gameJoinAttemptId": attempt_id,
                "browserTrackerId": 0,
                "playSessionId": session_id,
                "eventId": str(uuid.uuid4()),
                "launchData": "",
                "joinAttemptOrigin": "PlayButton",
            }
            if job_id:
                payload["jobId"] = job_id
            raw = json.dumps(payload).encode("utf-8")

            def send_raw(token: str | None) -> tuple[int, dict[str, str], bytes]:
                headers = {
                    "Host": "gamejoin.roblox.com",
                    "User-Agent": CLIENT_UA,
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Cookie": f".ROBLOSECURITY={session.cookie}",
                    "Content-Length": str(len(raw)),
                    "Connection": "keep-alive",
                }
                if token:
                    headers["X-CSRF-TOKEN"] = token
                conn.request("POST", "/v1/join-game", body=raw, headers=headers)
                resp = conn.getresponse()
                hdrs = {k.lower(): v for k, v in resp.getheaders()}
                return resp.status, hdrs, resp.read()

            status, hdrs, data = send_raw(session.csrf)
            if status == 403 and "x-csrf-token" in hdrs:
                session.csrf = hdrs["x-csrf-token"]
                status, hdrs, data = send_raw(session.csrf)

            if status != 200:
                msg = data.decode("utf-8", errors="replace")[:250]
                raise RuntimeError(f"join-game HTTP {status}: {msg}")
            return json.loads(data.decode("utf-8"))

        reply = post_once(None)
        tries = 0
        while reply.get("status") == 0 and tries < 60:
            tries += 1
            time.sleep(0.04)
            reply = post_once(None)

        if reply.get("status") != 2:
            st = reply.get("status")
            msg = reply.get("message") or ""
            raise RuntimeError(f"join-game failed (status {st}): {msg}")

        s = reply.get("joinScript")
        if not s or not isinstance(s, dict):
            job_id = reply.get("jobId")
            again = post_once(job_id)
            if again and isinstance(again, dict):
                if again.get("joinScript") and isinstance(again["joinScript"], dict):
                    s = again["joinScript"]
                reply.update(again)

        if not s or not isinstance(s, dict):
            raise RuntimeError("joinScript missing from join response")

        reply["status"] = 2
        reply["joinScript"] = s
        if not reply.get("joinScriptUrl"):
            job_enc = urllib.parse.quote(reply.get("jobId") or "")
            reply["joinScriptUrl"] = f"https://assetgame.roblox.com/Game/Join.ashx?placeId={place_id}&jobId={job_enc}"

        udmux = (s.get("UdmuxEndpoints") or [None])[0]
        connections = s.get("ServerConnections")

        res = {
            "jobId": reply.get("jobId"),
            "tries": tries,
            "userId": s.get("UserId"),
            "userName": s.get("UserName"),
            "machine": s.get("MachineAddress"),
            "serverPort": s.get("ServerPort"),
            "udmux": udmux,
            "connections": connections,
            "token": s.get("TokenValue"),
            "pepper": s.get("PepperId"),
            "clientTicket": s.get("ClientTicket"),
            "gameId": s.get("GameId"),
            "placeId": s.get("PlaceId"),
            "script": s,
            "rawReply": reply,
        }
        with session.lock:
            session.last_join_reply = reply
            session.last_join_script = s
        return res
    finally:
        try:
            conn.close()
        except Exception:
            pass

# ---------------------------------------------------------------------------
# HTTP & WebSocket Handler
# ---------------------------------------------------------------------------
class InsomniacHandler(BaseHTTPRequestHandler):
    server_version = "Insomniac/1.0"

    def log_message(self, fmt, *args):
        # Silence routine static asset logs in production
        if len(args) >= 2 and str(args[1]) in ("200", "304") and not str(args[0]).startswith("POST"):
            return
        sys.stderr.write(f"[{time.strftime('%H:%M:%S')}] {fmt % args}\n")

    def _get_session(self) -> tuple[ClientSession, bool]:
        cookie_header = self.headers.get("Cookie", "")
        sid = None
        for part in cookie_header.split(";"):
            part = part.strip()
            if part.startswith("insomniac_sid="):
                sid = part[len("insomniac_sid="):].strip()
                break
        if not sid:
            sid = self.headers.get("X-Session-ID", "").strip() or None
        return get_or_create_session(sid)

    def _respond_head(self, status: int, ct: str, length: int, cacheable: bool, is_new_sid: bool = False, sid: str = ""):
        self.send_response(status)
        self.send_header("content-type", ct)
        self.send_header("content-length", str(length))
        for name, value in SECURITY_HEADERS:
            self.send_header(name, value)
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-credentials", "true")
        self.send_header("access-control-allow-headers", "content-type, authorization, x-session-id")
        self.send_header("cache-control", "public, max-age=86400" if cacheable else "no-store")
        if is_new_sid and sid:
            self.send_header("set-cookie", f"insomniac_sid={sid}; Path=/; SameSite=Lax; Max-Age=31536000")
        self.end_headers()

    def _respond(self, status: int, ct: str, body: bytes, cacheable: bool, is_new_sid: bool = False, sid: str = ""):
        self._respond_head(status, ct, len(body), cacheable, is_new_sid=is_new_sid, sid=sid)
        try:
            self.wfile.write(body)
        except (ConnectionAbortedError, BrokenPipeError):
            pass

    def _respond_json(self, status: int, obj, is_new_sid: bool = False, sid: str = ""):
        raw = json.dumps(obj).encode("utf-8")
        self._respond(status, "application/json; charset=utf-8", raw, False, is_new_sid=is_new_sid, sid=sid)

    def do_OPTIONS(self):
        self.send_response(204)
        for name, value in SECURITY_HEADERS:
            self.send_header(name, value)
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-methods", "GET, POST, OPTIONS")
        self.send_header("access-control-allow-headers", "content-type, authorization, x-session-id")
        self.send_header("access-control-allow-credentials", "true")
        self.send_header("content-length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        sess, is_new = self._get_session()

        if parsed.path == "/__udp":
            self._handle_udp_ws(parsed)
            return

        if parsed.path == "/api/rbx/whoami":
            cookie = sess.cookie or clean_cookie_value(DEFAULT_COOKIE)
            if not cookie:
                self._respond_json(401, {"ok": False, "user": None}, is_new_sid=is_new, sid=sess.sid)
                return
            status, _, _, data, new_csrf = rbx_http_call(
                "https://users.roblox.com/v1/users/authenticated",
                cookie=cookie,
                csrf=sess.csrf,
            )
            if new_csrf:
                sess.csrf = new_csrf
            if status == 200:
                try:
                    u = json.loads(data.decode("utf-8"))
                    user = {"id": u.get("id"), "name": u.get("name"), "displayName": u.get("displayName")}
                    self._respond_json(200, user, is_new_sid=is_new, sid=sess.sid)
                    return
                except Exception:
                    pass
            self._respond_json(401, {"ok": False, "user": None}, is_new_sid=is_new, sid=sess.sid)
            return

        if parsed.path in ("/config.json", "/config"):
            self._respond_json(200, {"ok": True, "hasDefaultCookie": bool(DEFAULT_COOKIE)}, is_new_sid=is_new, sid=sess.sid)
            return

        # Serve static file from ROOT
        rel = parsed.path.lstrip("/") or "index.html"
        file = (ROOT / rel).resolve()
        try:
            file.relative_to(ROOT)
        except ValueError:
            self._respond(403, "text/plain", b"forbidden", False)
            return

        if file.is_dir():
            file = file / "index.html"

        if not file.is_file():
            self._respond(404, "text/plain", b"not found", False)
            return

        is_engine = rel.startswith("engine/") and not rel.endswith("WasmPlayer.js")
        body = read_cached(file, is_engine)
        self._respond(200, content_type(file), body, is_engine, is_new_sid=is_new, sid=sess.sid)

    def do_POST(self):
        parsed = urlparse(self.path)
        sess, is_new = self._get_session()
        length = int(self.headers.get("content-length") or 0)
        raw_body = self.rfile.read(length) if length > 0 else b"{}"
        try:
            doc = json.loads(raw_body.decode("utf-8", errors="replace"))
        except Exception:
            doc = {}

        if parsed.path == "/api/rbx/cookie":
            val = clean_cookie_value(doc.get("cookie", ""))
            if not val:
                self._respond_json(400, {"ok": False, "error": "empty cookie"}, is_new_sid=is_new, sid=sess.sid)
                return
            status, _, _, data, new_csrf = rbx_http_call(
                "https://users.roblox.com/v1/users/authenticated",
                cookie=val,
            )
            if status == 200:
                try:
                    u = json.loads(data.decode("utf-8"))
                    user = {"id": u.get("id"), "name": u.get("name"), "displayName": u.get("displayName")}
                    with sess.lock:
                        sess.cookie = val
                        sess.csrf = new_csrf
                    self._respond_json(200, {"ok": True, "user": user}, is_new_sid=True, sid=sess.sid)
                    return
                except Exception:
                    pass
            self._respond_json(400, {"ok": False, "error": "cookie rejected by roblox"}, is_new_sid=is_new, sid=sess.sid)
            return

        if parsed.path == "/api/rbx/logout":
            try:
                rbx_http_call("https://auth.roblox.com/v2/logout", method="POST", cookie=sess.cookie, csrf=sess.csrf)
            except Exception:
                pass
            with sess.lock:
                sess.cookie = ""
                sess.csrf = ""
                sess.last_join_reply = None
                sess.last_join_script = None
            self._respond_json(200, {"ok": True}, is_new_sid=is_new, sid=sess.sid)
            return

        if parsed.path == "/api/rbx/join":
            place_id = int(doc.get("placeId") or 0)
            if not place_id:
                self._respond_json(400, {"error": "missing placeId"}, is_new_sid=is_new, sid=sess.sid)
                return
            try:
                res = perform_gamejoin(place_id, sess)
                self._respond_json(200, res, is_new_sid=is_new, sid=sess.sid)
            except Exception as e:
                self._respond_json(500, {"error": str(e)}, is_new_sid=is_new, sid=sess.sid)
            return

        if parsed.path == "/api/rbx/request":
            target_url = str(doc.get("url") or "")
            if not target_url:
                self._respond_json(400, {"error": "missing url"}, is_new_sid=is_new, sid=sess.sid)
                return

            with sess.lock:
                cached_reply = sess.last_join_reply
                cached_script = sess.last_join_script

            if cached_reply and ("gamejoin.roblox.com/v1/join-" in target_url or "gamejoin.roblox.com/v2/join-" in target_url):
                b64 = base64.b64encode(json.dumps(cached_reply).encode("utf-8")).decode("ascii")
                self._respond_json(200, {
                    "status": 200,
                    "url": target_url,
                    "headers": {"content-type": "application/json; charset=utf-8"},
                    "body": b64,
                }, is_new_sid=is_new, sid=sess.sid)
                return

            if cached_script and "/Game/Join.ashx" in target_url:
                b64 = base64.b64encode(json.dumps(cached_script).encode("utf-8")).decode("ascii")
                self._respond_json(200, {
                    "status": 200,
                    "url": target_url,
                    "headers": {"content-type": "application/json; charset=utf-8"},
                    "body": b64,
                }, is_new_sid=is_new, sid=sess.sid)
                return

            method = str(doc.get("method") or "GET").upper()
            headers = doc.get("headers") or {}
            req_body: bytes | None = None
            if doc.get("bodyB64"):
                try:
                    req_body = base64.b64decode(doc["bodyB64"])
                except Exception:
                    req_body = b""
            elif doc.get("body") is not None:
                b = doc["body"]
                req_body = b.encode("utf-8") if isinstance(b, str) else bytes(b)

            try:
                status, final_url, res_headers, data, new_csrf = rbx_http_call(
                    target_url,
                    method=method,
                    headers=headers,
                    body=req_body,
                    cookie=sess.cookie,
                    csrf=sess.csrf,
                )
                if new_csrf:
                    sess.csrf = new_csrf
                clean_headers = {
                    k: v
                    for k, v in res_headers.items()
                    if k.lower() not in ("transfer-encoding", "content-encoding", "content-length", "connection")
                }
                self._respond_json(200, {
                    "status": status,
                    "url": final_url,
                    "headers": clean_headers,
                    "body": base64.b64encode(data).decode("ascii"),
                }, is_new_sid=is_new, sid=sess.sid)
            except Exception as e:
                self._respond_json(500, {"error": str(e)}, is_new_sid=is_new, sid=sess.sid)
            return

        self._respond(404, "text/plain", b"not found", False)

    def _handle_udp_ws(self, parsed):
        qs = parse_qs(parsed.query)
        host = (qs.get("host") or [""])[0].strip()
        port = int((qs.get("port") or ["0"])[0] or 0)
        ws_key = self.headers.get("Sec-WebSocket-Key")
        if not host or not port or not ws_key:
            self._respond(400, "text/plain", b"bad websocket request", False)
            return

        magic = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        accept = base64.b64encode(hashlib.sha1(ws_key.encode("ascii") + magic).digest()).decode("ascii")

        self.send_response(101)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.send_header("Sec-WebSocket-Protocol", "binary")
        self.end_headers()

        try:
            self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except Exception:
            pass

        udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        udp_sock.settimeout(0.005)
        try:
            udp_sock.connect((host, port))
        except Exception as e:
            sys.stderr.write(f"[udp-ws] connect to {host}:{port} failed: {e}\n")
            udp_sock.close()
            return

        closed = threading.Event()

        def udp_to_ws():
            while not closed.is_set():
                try:
                    data = udp_sock.recv(4096)
                except (socket.timeout, BlockingIOError):
                    continue
                except OSError:
                    break
                if not data:
                    continue

                ln = len(data)
                if ln < 126:
                    hdr = bytes([0x82, ln])
                elif ln <= 0xFFFF:
                    hdr = struct.pack(">BBH", 0x82, 126, ln)
                else:
                    hdr = struct.pack(">BBQ", 0x82, 127, ln)

                try:
                    self.wfile.write(hdr + data)
                    self.wfile.flush()
                except Exception:
                    break
            closed.set()

        t = threading.Thread(target=udp_to_ws, daemon=True)
        t.start()

        def read_exact(n: int) -> bytes | None:
            buf = bytearray()
            while len(buf) < n:
                try:
                    chunk = self.rfile.read(n - len(buf))
                except Exception:
                    return None
                if not chunk:
                    return None
                buf.extend(chunk)
            return bytes(buf)

        try:
            while not closed.is_set():
                head = read_exact(2)
                if not head:
                    break
                b1, b2 = head[0], head[1]
                opcode = b1 & 0x0F
                masked = (b2 & 0x80) != 0
                plen = b2 & 0x7F

                if opcode == 0x8:  # CLOSE
                    break
                elif opcode == 0x9:  # PING
                    body = read_exact(plen) if plen else b""
                    mask = read_exact(4) if masked else None
                    pong = bytes([0x8A, plen]) + (body or b"")
                    self.wfile.write(pong)
                    self.wfile.flush()
                    continue

                if plen == 126:
                    ext = read_exact(2)
                    if not ext:
                        break
                    plen = struct.unpack(">H", ext)[0]
                elif plen == 127:
                    ext = read_exact(8)
                    if not ext:
                        break
                    plen = struct.unpack(">Q", ext)[0]

                mask_key = read_exact(4) if masked else None
                payload = read_exact(plen) if plen else b""
                if payload and mask_key:
                    m = mask_key
                    payload = bytes(b ^ m[i & 3] for i, b in enumerate(payload))

                if opcode in (0x2, 0x0) and payload:  # Binary frame
                    try:
                        udp_sock.send(payload)
                    except OSError:
                        pass
        except Exception:
            pass
        finally:
            closed.set()
            try:
                udp_sock.close()
            except Exception:
                pass


def serve():
    for warm in ("engine/WebClient.js", "engine/WebClient.metadata.json"):
        p = ROOT / warm
        if p.is_file():
            read_cached(p, True)

    server = ThreadingHTTPServer(("0.0.0.0", PORT), InsomniacHandler)
    print(f"=== Insomniac Cloud Host Ready ===", flush=True)
    print(f"Serving {ROOT} on http://0.0.0.0:{PORT}/", flush=True)
    print(f"Default ROBLOSECURITY set: {'YES' if DEFAULT_COOKIE else 'NO'}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    serve()

