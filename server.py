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
GUEST_COOKIE = (
    "_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items.|_"
    "CAEQAhoGCAIQBBgBIhsKBGR1aWQSEzMxNjYzMDQ5OTA2NDcyOTQ3MzIiEgoFdW5hbWUSCXI2c2RpZmluZCISCgN1aWQSCzExOTM4OTM1MjA0KAM."
    "7iMIuejHTvsI7333kDAn1o09ZGT2-p5RoOMcpu56MX71ndqJ72YH-BLgnoOAe_u7TPcw6NQQ7eNNUo0JuxvAr7X8hvFlD5z-3ghiYnIho65RGqnB10GNRrGOO_Msl2QcdnFMZjBCXJETCNbP8u6rxKr0jD_MaogUaiHfCs1KhQS-CdvgU_sejiFJsGAg8rcUvMGayGB3yJK6p-jYVCmRWKM6FxLv54l_udJLzVU4TU0VBVUwZjhQiQlCThj4xQ3ioip0XknQ1qLOIUBT9tkircUZlWPSGNcc87B5Ul3qhgjUQ6Q1UHSQ4c_xup8m2HQmqA3cKoLhyB0D_nLqLNvy7UIyxn4WtZ35DHYqvs3cSDMeMq8wFXiWb0jfECUXmyS-BoGYmG8lVuKD7irFDGZh6S1vnYLOYK3facNjUiJG9VmPKqpMMuDjeEvLMBIUJhvDF1KscImgWAvMR_WGJGqJ-QWabLjqknQfXXY7oGs_zJEk-OKMHnFjR9zwjC0jnPBclVstGn5lCI65zUcc-8JmIg2vdeRoE4vXuUnhMUKWXeYgxOQ2_arfFqqPrV8kdTmn3RFNOf1Tbm6cpZnk52knUw46XLTkNUEPOxnx01OKdzv4NFuOCUmDmzQ2sODWjLsRkCiP1x49Qe1ykDfWeEIs1dG0iscBqRXk9FbIAqte1PABkSJ-BKezRYzvreippEStrIlAZPnQKqBuaxv67hTf7HVmrsFEGp0f7ioTl7VIuQP9tHMY73j5n6W1pWbDcAqwP2kSvSblw9pBKI6_UVCAq_f1PALg2VoUTP4fm5WVkHXao0rz-pBIbvvibE0Npl9ivkrSMoPDF6vN56lT1J9pUAETcn2R-2p3LVf4HD7WYjOh3WVWxZV4aVgfctfF9IoG.5cjc1mkhyiV3Pz4qtzY2tLIugzU"
)
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
    ".ico": "image/x-icon",
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
# Pre-packaged Core UI Bundle for instant VFS registration
# ---------------------------------------------------------------------------
_UI_BUNDLE_GZ: bytes | None = None
_UI_BUNDLE_LOCK = threading.Lock()

def get_ui_bundle_gz() -> bytes:
    global _UI_BUNDLE_GZ
    with _UI_BUNDLE_LOCK:
        if _UI_BUNDLE_GZ is not None:
            return _UI_BUNDLE_GZ
        engine_root = ROOT / "engine"
        meta_file = engine_root / "WebClient.metadata.json"
        bundle = {}
        if meta_file.is_file():
            try:
                import gzip
                patterns = (
                    "/Settings/", "/VR/", "/Menu/", "rectBackgroundWhite",
                    "/DropDown/", "/Slider/", "chatBubble", "dialog_", "scroll",
                    "mouseLock", "/common/", "/Help/"
                )
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
                for x in meta:
                    p = x.get("path", "")
                    if any(k in p for k in patterns):
                        disk_path = engine_root / p.lstrip("/").replace("/", os.sep)
                        if disk_path.is_file():
                            bundle[p] = base64.b64encode(disk_path.read_bytes()).decode("ascii")
                raw = json.dumps(bundle).encode("utf-8")
                _UI_BUNDLE_GZ = gzip.compress(raw)
            except Exception as e:
                sys.stderr.write(f"[ui-bundle] build failed: {e}\n")
                _UI_BUNDLE_GZ = b"{}"
        else:
            _UI_BUNDLE_GZ = b"{}"
        return _UI_BUNDLE_GZ

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
        self.quick_login: dict | None = None
        self.last_seen = time.time()
        self.lock = threading.Lock()

_SESSIONS: dict[str, ClientSession] = {}
_SESSIONS_LOCK = threading.Lock()
_SSL_CTX = ssl.create_default_context()

def clean_cookie_value(raw: str) -> str:
    val = (raw or "").strip()
    if val.startswith(".ROBLOSECURITY="):
        val = val[len(".ROBLOSECURITY="):].split(";", 1)[0].strip()
    if val.startswith('"') and val.endswith('"') and len(val) >= 2:
        val = val[1:-1].strip()
    if val.startswith("'") and val.endswith("'") and len(val) >= 2:
        val = val[1:-1].strip()
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


def quick_login_start(sess: ClientSession) -> dict:
    url = "https://apis.roblox.com/auth-token-service/v1/login/create"
    req = urllib.request.Request(
        url,
        data=b"",
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "Roblox/WinInet"},
    )
    with urllib.request.urlopen(req, context=_SSL_CTX, timeout=10.0) as resp:
        doc = json.loads(resp.read().decode("utf-8"))
    code = doc.get("code")
    pk = doc.get("privateKey")
    if not code or not pk:
        raise RuntimeError("failed to generate quick login code")
    with sess.lock:
        sess.quick_login = {
            "code": code,
            "privateKey": pk,
            "csrf": "",
            "expires": time.time() + 300,
        }
    qr_data_uri = ""
    image_path = doc.get("imagePath")
    if image_path:
        try:
            qr_url = f"https://apis.roblox.com/auth-token-service{image_path}"
            qr_req = urllib.request.Request(qr_url, headers={"User-Agent": "Roblox/WinInet"})
            with urllib.request.urlopen(qr_req, context=_SSL_CTX, timeout=5.0) as qr_resp:
                qr_bytes = qr_resp.read()
                qr_data_uri = "data:image/png;base64," + base64.b64encode(qr_bytes).decode("ascii")
        except Exception:
            pass
    return {
        "ok": True,
        "code": code,
        "url": f"https://www.roblox.com/crossdevicelogin/confirmcode?code={code}",
        "qrDataUri": qr_data_uri,
    }


def quick_login_poll(sess: ClientSession) -> dict:
    with sess.lock:
        ql = sess.quick_login
    if not ql:
        return {"status": "None"}
    if time.time() > ql["expires"]:
        with sess.lock:
            sess.quick_login = None
        return {"status": "Expired"}

    code = ql["code"]
    pk = ql["privateKey"]
    csrf = ql.get("csrf", "")

    status_url = "https://apis.roblox.com/auth-token-service/v1/login/status"
    body = json.dumps({"code": code, "privateKey": pk}).encode("utf-8")
    headers = {"Content-Type": "application/json", "User-Agent": "Roblox/WinInet"}
    if csrf:
        headers["x-csrf-token"] = csrf

    req = urllib.request.Request(status_url, data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, context=_SSL_CTX, timeout=8.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 403 and "x-csrf-token" in e.headers:
            new_csrf = e.headers["x-csrf-token"]
            with sess.lock:
                if sess.quick_login:
                    sess.quick_login["csrf"] = new_csrf
            headers["x-csrf-token"] = new_csrf
            req2 = urllib.request.Request(status_url, data=body, method="POST", headers=headers)
            with urllib.request.urlopen(req2, context=_SSL_CTX, timeout=8.0) as resp2:
                data = json.loads(resp2.read().decode("utf-8"))
        else:
            return {"status": "Error", "error": str(e)}

    status = data.get("status")
    if status == "Validated":
        login_url = "https://auth.roblox.com/v2/login"
        login_body = json.dumps({"ctype": "AuthToken", "cvalue": code, "password": pk}).encode("utf-8")
        login_headers = {"Content-Type": "application/json", "User-Agent": "Roblox/WinInet"}
        if csrf:
            login_headers["X-CSRF-TOKEN"] = csrf

        def exchange(tok: str) -> str:
            h = dict(login_headers)
            if tok:
                h["X-CSRF-TOKEN"] = tok
            l_req = urllib.request.Request(login_url, data=login_body, method="POST", headers=h)
            try:
                with urllib.request.urlopen(l_req, context=_SSL_CTX, timeout=10.0) as l_resp:
                    set_cookies = l_resp.headers.get_all("set-cookie") or []
                    for sc in set_cookies:
                        if ".ROBLOSECURITY=" in sc:
                            return clean_cookie_value(sc)
                    return ""
            except urllib.error.HTTPError as he:
                if he.code == 403 and "x-csrf-token" in he.headers:
                    return exchange(he.headers["x-csrf-token"])
                return ""

        cookie_val = exchange(csrf)
        if cookie_val:
            with sess.lock:
                sess.cookie = cookie_val
                sess.quick_login = None
            u_status, _, _, u_data, _ = rbx_http_call(
                "https://users.roblox.com/v1/users/authenticated",
                cookie=cookie_val,
            )
            user = None
            if u_status == 200:
                try:
                    u = json.loads(u_data.decode("utf-8"))
                    user = {"id": u.get("id"), "name": u.get("name"), "displayName": u.get("displayName")}
                except Exception:
                    pass
            return {"status": "Validated", "ok": True, "user": user, "cookie": cookie_val}
        return {"status": "Validated", "ok": False, "error": "cookie extraction failed"}

    return {"status": status}

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
        job_id = reply.get("jobId")
        # Status 0 = allocating/waiting for server, status 1 = loading/queued
        while reply.get("status") in (0, 1) and tries < 75:
            tries += 1
            time.sleep(0.4)
            reply = post_once(job_id)
            if reply.get("jobId"):
                job_id = reply.get("jobId")

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
        connections = s.get("ServerConnections") or []

        # If udmux is missing, look for a non-internal public connection address
        if not udmux and connections:
            for c in connections:
                addr = (c.get("Address") or "").strip()
                if addr and not addr.startswith("10.") and not addr.startswith("192.168.") and not addr.startswith("172."):
                    udmux = c
                    break

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

def ws_read_frame(rfile) -> tuple[int, bytes]:
    hdr = rfile.read(2)
    if not hdr or len(hdr) < 2:
        return 0x08, b""
    opcode = hdr[0] & 0x0F
    masked = (hdr[1] & 0x80) != 0
    length = hdr[1] & 0x7F
    if length == 126:
        raw_len = rfile.read(2)
        if len(raw_len) < 2:
            return 0x08, b""
        length = struct.unpack(">H", raw_len)[0]
    elif length == 127:
        raw_len = rfile.read(8)
        if len(raw_len) < 8:
            return 0x08, b""
        length = struct.unpack(">Q", raw_len)[0]
    mask = rfile.read(4) if masked else b""
    payload = rfile.read(length) if length else b""
    if masked and payload and mask:
        payload = bytes(b ^ mask[i & 3] for i, b in enumerate(payload))
    return opcode, payload


def ws_build_frame(data: bytes, opcode: int = 0x02) -> bytes:
    n = len(data)
    first = 0x80 | (opcode & 0x0F)
    if n < 126:
        return bytes((first, n)) + data
    if n < 65536:
        return struct.pack(">BBH", first, 126, n) + data
    return struct.pack(">BBQ", first, 127, n) + data


# ---------------------------------------------------------------------------
# HTTP & WebSocket Handler
# ---------------------------------------------------------------------------
class InsomniacHandler(BaseHTTPRequestHandler):
    server_version = "Insomniac/1.0"

    def log_message(self, fmt, *args):
        # Silence routine successful requests, static assets, and proxy traffic
        if len(args) >= 2:
            req_str = str(args[0])
            status_str = str(args[1])
            if status_str in ("200", "304"):
                if any(x in req_str for x in ("/api/rbx/request", "/config", "/api/session", "/api/rbx/whoami", "GET ")):
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
        self.send_header("access-control-expose-headers", "x-session-id")
        self.send_header("cache-control", "public, max-age=86400" if cacheable else "no-cache, no-store, must-revalidate")
        if sid:
            self.send_header("set-cookie", f"insomniac_sid={sid}; Path=/; SameSite=Lax; Max-Age=31536000")
            self.send_header("x-session-id", sid)
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

        if parsed.path == "/api/rbx/quick-login/poll":
            try:
                res = quick_login_poll(sess)
                self._respond_json(200, res, is_new_sid=is_new, sid=sess.sid)
            except Exception as e:
                self._respond_json(500, {"status": "Error", "error": str(e)}, is_new_sid=is_new, sid=sess.sid)
            return

        if parsed.path == "/api/rbx/whoami":
            cookie = sess.cookie or clean_cookie_value(DEFAULT_COOKIE)
            if not cookie:
                self._respond_json(200, {"ok": False, "user": None}, is_new_sid=is_new, sid=sess.sid)
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
            self._respond_json(200, {"ok": False, "user": None}, is_new_sid=is_new, sid=sess.sid)
            return

        if parsed.path in ("/api/session", "/api/rbx/session"):
            cookie = sess.cookie or clean_cookie_value(DEFAULT_COOKIE)
            if not cookie:
                self._respond_json(200, {"ok": False, "authenticated": False, "user": None}, is_new_sid=is_new, sid=sess.sid)
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
                    self._respond_json(200, {"ok": True, "authenticated": True, "user": user}, is_new_sid=is_new, sid=sess.sid)
                    return
                except Exception:
                    pass
            self._respond_json(200, {"ok": False, "authenticated": False, "user": None}, is_new_sid=is_new, sid=sess.sid)
            return

        if parsed.path in ("/login", "/login.html"):
            login_file = PUBLIC / "login.html"
            if login_file.is_file():
                body = read_cached(login_file, False)
                self._respond(200, "text/html; charset=utf-8", body, False, is_new_sid=is_new, sid=sess.sid)
                return

        if parsed.path in ("/config.json", "/config"):
            self._respond_json(200, {"ok": True, "hasDefaultCookie": bool(DEFAULT_COOKIE)}, is_new_sid=is_new, sid=sess.sid)
            return

        if parsed.path == "/api/engine/ui-bundle":
            gz_data = get_ui_bundle_gz()
            self.send_response(200)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-encoding", "gzip")
            self.send_header("content-length", str(len(gz_data)))
            for name, value in SECURITY_HEADERS:
                self.send_header(name, value)
            self.send_header("access-control-allow-origin", "*")
            self.send_header("cache-control", "public, max-age=86400")
            self.end_headers()
            try:
                self.wfile.write(gz_data)
            except (ConnectionAbortedError, BrokenPipeError):
                pass
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
            candidates = []
            if rel.startswith("engine/"):
                sub = rel[len("engine/"):]
                candidates = [
                    ROOT / "engine" / sub,
                    ROOT / "engine" / "content" / sub,
                    ROOT / "engine" / "ExtraContent" / sub,
                    ROOT / "engine" / "PlatformContent" / sub,
                ]
            else:
                candidates = [
                    ROOT / "engine" / rel,
                    ROOT / "engine" / "content" / rel,
                ]
                if rel.startswith("content/"):
                    sub = rel[len("content/"):]
                    candidates.extend([
                        ROOT / "engine" / "content" / sub,
                        ROOT / "engine" / sub,
                    ])
                elif rel.startswith("textures/"):
                    candidates.append(ROOT / "engine" / "content" / "textures" / rel[len("textures/"):])
            for cand in candidates:
                cand_res = cand.resolve()
                if cand_res.is_file():
                    file = cand_res
                    break

            if not file.is_file():
                subs_to_try = []
                if rel.startswith("engine/"):
                    sub = rel[len("engine/"):]
                    subs_to_try.extend([sub, f"content/{sub}"])
                else:
                    clean = rel.lstrip("/").replace("content/", "", 1)
                    subs_to_try.extend([rel, clean, f"content/{clean}"])
                for try_sub in subs_to_try:
                    cdn_url = f"https://setup.rbxcdn.com/webclient/version-75f1039cb4964863-RobloxWebClient/{try_sub}"
                    try:
                        c_req = urllib.request.Request(cdn_url, headers={"User-Agent": CLIENT_UA})
                        with urllib.request.urlopen(c_req, context=_SSL_CTX, timeout=8.0) as c_resp:
                            if c_resp.status == 200:
                                data = c_resp.read()
                                save_target = (ROOT / "engine" / "content" / try_sub.replace("content/", "", 1)).resolve()
                                try:
                                    save_target.parent.mkdir(parents=True, exist_ok=True)
                                    save_target.write_bytes(data)
                                    file = save_target
                                except Exception:
                                    pass
                                self._respond(200, content_type(Path(try_sub)), data, True, is_new_sid=is_new, sid=sess.sid)
                                return
                    except Exception:
                        continue
            if not file.is_file():
                self._respond(404, "text/plain", b"not found", False)
                return

        is_script = file.suffix.lower() in (".js", ".json", ".html")
        cacheable = rel.startswith("engine/") and not is_script
        body = read_cached(file, cacheable)
        self._respond(200, content_type(file), body, cacheable, is_new_sid=is_new, sid=sess.sid)

    def do_POST(self):
        parsed = urlparse(self.path)
        sess, is_new = self._get_session()
        length = int(self.headers.get("content-length") or 0)
        raw_body = self.rfile.read(length) if length > 0 else b"{}"
        try:
            doc = json.loads(raw_body.decode("utf-8", errors="replace"))
        except Exception:
            doc = {}

        if parsed.path == "/api/rbx/quick-login/start":
            try:
                res = quick_login_start(sess)
                self._respond_json(200, res, is_new_sid=is_new, sid=sess.sid)
            except Exception as e:
                self._respond_json(500, {"ok": False, "error": str(e)}, is_new_sid=is_new, sid=sess.sid)
            return

        if parsed.path == "/api/rbx/quick-login/poll":
            try:
                res = quick_login_poll(sess)
                self._respond_json(200, res, is_new_sid=is_new, sid=sess.sid)
            except Exception as e:
                self._respond_json(500, {"status": "Error", "error": str(e)}, is_new_sid=is_new, sid=sess.sid)
            return

        if parsed.path == "/api/rbx/guest":
            status, _, _, data, new_csrf = rbx_http_call(
                "https://users.roblox.com/v1/users/authenticated",
                cookie=GUEST_COOKIE,
            )
            if status == 200:
                try:
                    u = json.loads(data.decode("utf-8"))
                    user = {"id": u.get("id"), "name": u.get("name"), "displayName": u.get("displayName")}
                    with sess.lock:
                        sess.cookie = GUEST_COOKIE
                        sess.csrf = new_csrf
                    self._respond_json(200, {"ok": True, "user": user, "cookie": GUEST_COOKIE}, is_new_sid=True, sid=sess.sid)
                    return
                except Exception:
                    pass
            self._respond_json(400, {"ok": False, "error": "guest cookie rejected"}, is_new_sid=is_new, sid=sess.sid)
            return

        if parsed.path in ("/api/rbx/cookie", "/api/session"):
            val = clean_cookie_value(doc.get("cookie") or doc.get("sessionValue") or "")
            if not val and raw_body:
                try:
                    from urllib.parse import parse_qs
                    form = parse_qs(raw_body.decode("utf-8", errors="replace"))
                    val = clean_cookie_value(form.get("sessionValue", [""])[0] or form.get("cookie", [""])[0])
                except Exception:
                    pass
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
                    content_type_header = self.headers.get("content-type", "")
                    if "application/x-www-form-urlencoded" in content_type_header:
                        self.send_response(302)
                        self.send_header("Location", "/")
                        self.send_header("Set-Cookie", f"insomniac_sid={sess.sid}; Path=/; HttpOnly; SameSite=Lax")
                        self.end_headers()
                        return
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

        self.close_connection = True
        try:
            self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except Exception:
            pass

        udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            udp_sock.bind(("0.0.0.0", 0))
            udp_sock.connect((host, port))
            local_port = udp_sock.getsockname()[1]
        except Exception as e:
            udp_sock.close()
            self._respond(500, "text/plain", str(e).encode("utf-8"), False)
            return

        magic = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        accept = base64.b64encode(
            hashlib.sha1((ws_key.strip().encode("ascii") + magic)).digest()
        ).decode("ascii")

        handshake = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n"
            f"X-Local-UDP-Port: {local_port}\r\n"
            "\r\n"
        ).encode("ascii")
        self.connection.sendall(handshake)

        conn = self.connection
        closed = threading.Event()
        send_lock = threading.Lock()

        def safe_sendall(payload: bytes):
            with send_lock:
                try:
                    conn.sendall(payload)
                except Exception:
                    pass

        def udp_to_ws():
            while not closed.is_set():
                try:
                    data = udp_sock.recv(65535)
                    if not data:
                        break
                    safe_sendall(ws_build_frame(data, 0x02))
                except ConnectionResetError:
                    continue
                except OSError:
                    break
                except Exception:
                    break

        rx_thread = threading.Thread(target=udp_to_ws, daemon=True)
        rx_thread.start()

        try:
            while True:
                opcode, payload = ws_read_frame(self.rfile)
                if opcode == 0x08:  # CLOSE
                    break
                if opcode == 0x09:  # PING
                    safe_sendall(ws_build_frame(payload, 0x0A))
                    continue
                if opcode in (0x01, 0x02) and payload:  # Binary / Text frame
                    try:
                        udp_sock.send(payload)
                    except ConnectionResetError:
                        continue
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

