// auth.js — works natively in a normal Chrome tab (via rkhost.py /api/rbx/*)
// and in an IWA (via <controlledframe>).
(() => {
  const LOGIN_ORIGIN = "https://www.roblox.com/robots.txt";
  const GAMEJOIN = "https://gamejoin.roblox.com/v1/join-game";
  const CLIENT_UA = "Roblox/WinInet";
  const IS_IWA = typeof location !== "undefined" && location.protocol === "isolated-app:";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function b64ToUtf8(b64) {
    if (!b64) return "";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function utf8ToB64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }

  class RobloxAuth {
    constructor(opts = {}) {
      this.partition = opts.partition || "persist:roblox";
      this.onLog = opts.onLog || (() => {});
      this.frame = null;
      this.overlay = null;
      this.loginPopup = null;
      this.interceptor = null;
      this.seq = 0;
      this.loaded = false;
      this.lastJoinReply = null;
      this.lastJoinScript = null;
      this.pendingJoinPromise = null;
    }

    log(msg) {
      this.onLog(String(msg));
      console.log("[auth] " + msg);
    }

    // ------------------------------------------------------------- start ----
    async start(mount = document.body) {
      if (!IS_IWA) {
        this._ensureWebOverlay(mount);
        this.loaded = true;
        return this.overlay;
      }

      if (this.frame) return this.frame;

      const el = document.createElement("controlledframe");
      el.id = "rbx-auth";
      el.setAttribute("partition", this.partition);
      el.setAttribute("src", LOGIN_ORIGIN);
      el.style.cssText =
        "position:fixed;left:0;top:0;width:100%;height:100%;border:0;background:#1a1b26;opacity:0;pointer-events:none;z-index:-1";

      const loaded = new Promise((resolve) => {
        let settled = false;
        const done = (ok, detail) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          el.removeEventListener("loadstop", onStop);
          el.removeEventListener("loadcommit", onCommit);
          el.removeEventListener("loadabort", onAbort);
          this.loaded = ok;
          this.log(`frame ${ok ? "ready" : "aborted"}: ${detail}`);
          resolve(ok);
        };
        const onCommit = (e) => {
          if (!e || e.isTopLevel !== false) done(true, "loadcommit");
        };
        const onStop = () => done(true, "loadstop");
        const onAbort = (e) => done(false, e.url || "unknown");
        el.addEventListener("loadcommit", onCommit);
        el.addEventListener("loadstop", onStop);
        el.addEventListener("loadabort", onAbort);
        const timer = setTimeout(() => done(false, "timeout"), 2500);
      });

      mount.appendChild(el);
      this.frame = el;
      this.installInterceptor();
      await loaded;
      return el;
    }

    _ensureWebOverlay(mount = document.body) {
      if (this.overlay) return this.overlay;
      const wrap = document.createElement("div");
      wrap.id = "rbx-web-login-overlay";
      wrap.style.cssText = [
        "position:fixed",
        "inset:0",
        "width:100vw",
        "height:100vh",
        "margin:0",
        "padding:24px",
        "box-sizing:border-box",
        "background-color:#111218",
        "background-image:radial-gradient(circle at center, rgba(18,20,30,0.52) 0%, rgba(10,11,16,0.88) 100%), url('/login-bg.jpg')",
        "background-size:cover",
        "background-position:center center",
        "background-repeat:no-repeat",
        "display:none",
        "align-items:center",
        "justify-content:center",
        "z-index:200",
      ].join(";");
      wrap.innerHTML = `
        <div style="width:100%;max-width:380px;margin:auto;box-sizing:border-box;background:rgba(24,26,36,0.92);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:32px 28px;box-shadow:0 24px 64px rgba(0,0,0,0.75);color:#ffffff;display:flex;flex-direction:column;align-items:center;text-align:center;">
          <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:24px;color:#ffffff;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
            <span style="font-size:24px;font-weight:800;letter-spacing:0.3px;">Insomniac</span>
          </div>
          <button id="web-login-open-btn" style="width:100%;height:44px;border-radius:8px;border:none;background:#ffffff;color:#111218;font-size:15px;font-weight:800;cursor:pointer;transition:opacity 0.15s;">
            Login
          </button>
          <div style="display:flex;align-items:center;width:100%;gap:10px;margin:16px 0;color:rgba(255,255,255,0.45);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">
            <div style="flex:1;height:1px;background:rgba(255,255,255,0.12);"></div>
            <span>or</span>
            <div style="flex:1;height:1px;background:rgba(255,255,255,0.12);"></div>
          </div>
          <div style="display:flex;width:100%;gap:8px;box-sizing:border-box;">
            <input id="web-login-cookie-input" type="password" placeholder="Paste .ROBLOSECURITY" style="flex:1;min-width:0;height:40px;box-sizing:border-box;background:rgba(12,13,19,0.85);border:1px solid rgba(255,255,255,0.16);border-radius:8px;padding:0 12px;color:#ffffff;font-size:13px;outline:none;" />
            <button id="web-login-cookie-btn" style="height:40px;padding:0 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.1);color:#ffffff;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;">
              Paste Cookie
            </button>
          </div>
          <div id="web-login-status" style="display:none;margin-top:12px;font-size:12px;font-weight:600;color:#f7768e;line-height:1.4;"></div>
          <div style="margin-top:16px;font-size:11px;color:rgba(255,255,255,0.45);line-height:1.4;">
            How to get cookie: On <b>roblox.com</b>, press <b>F12</b> &rarr; <b>Application</b> &rarr; <b>Cookies</b> &rarr; copy <b>.ROBLOSECURITY</b> value
          </div>
        </div>
      `;
      mount.appendChild(wrap);
      this.overlay = wrap;

      const openRbx = (url) => {
        const w = 480;
        const h = 640;
        const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
        const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
        this.loginPopup = window.open(
          url,
          "insomniac_login_frame",
          `popup=yes,width=${w},height=${h},left=${left},top=${top}`
        );
      };

      const loginBtn = wrap.querySelector("#web-login-open-btn");
      const cookieInput = wrap.querySelector("#web-login-cookie-input");
      const cookieBtn = wrap.querySelector("#web-login-cookie-btn");
      const statusEl = wrap.querySelector("#web-login-status");

      if (loginBtn) {
        loginBtn.addEventListener("click", () => {
          openRbx("https://www.roblox.com/login");
          if (statusEl) {
            statusEl.style.display = "block";
            statusEl.style.color = "#a9b1d6";
            statusEl.textContent = "Opened Roblox login! Once logged in, paste your .ROBLOSECURITY cookie below to finish connecting.";
          }
        });
      }

      const submitCookie = async () => {
        const val = (cookieInput && cookieInput.value ? cookieInput.value : "").trim();
        if (!val) return;
        if (statusEl) {
          statusEl.style.display = "block";
          statusEl.style.color = "#a9b1d6";
          statusEl.textContent = "Verifying...";
        }
        try {
          await this.injectCookie(val);
          if (cookieInput) cookieInput.value = "";
          if (statusEl) {
            statusEl.style.display = "none";
            statusEl.textContent = "";
          }
        } catch (e) {
          if (statusEl) {
            statusEl.style.display = "block";
            statusEl.style.color = "#f7768e";
            statusEl.textContent = "Invalid cookie: " + (e && e.message ? e.message : "rejected by Roblox");
          }
        }
      };

      if (cookieBtn) cookieBtn.addEventListener("click", submitCookie);
      if (cookieInput) {
        cookieInput.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") submitCookie();
        });
        cookieInput.addEventListener("paste", () => {
          setTimeout(submitCookie, 60);
        });
      }

      return wrap;
    }

    installInterceptor() {
      if (!IS_IWA || this.interceptor || !this.frame || !this.frame.request) return this.interceptor;
      this.interceptor = this.frame.request.createWebRequestInterceptor({
        urlPatterns: ["*://gamejoin.roblox.com/*"],
        blocking: true,
        includeHeaders: "all",
      });
      this.interceptor.addEventListener("beforesendheaders", (event) => {
        try {
          const original = event.headers || event.request?.headers;
          const headers = new Headers(original);
          headers.set("User-Agent", CLIENT_UA);
          event.setRequestHeaders(headers);
        } catch (e) {
          this.log("interceptor: " + e);
        }
      });
      this.interceptor.addEventListener("erroroccurred", (e) => this.log("request failed: " + (e.error || e.url)));
      return this.interceptor;
    }

    // ------------------------------------------------------- executeScript ---
    async evalAsync(body, timeoutMs = 20000) {
      if (!this.frame) throw new Error("frame not started");
      const id = ++this.seq;
      const boot = `window.__rbx = window.__rbx || {};
        window.__rbx[${id}] = { done: false };
        (async () => {
          try { window.__rbx[${id}] = { done: true, ok: true, value: await (async () => { ${body} })() }; }
          catch (e) { window.__rbx[${id}] = { done: true, ok: false, error: String(e) }; }
        })();
        'go'`;
      await this.frame.executeScript({ code: boot });

      const deadline = performance.now() + timeoutMs;
      let step = 0;
      while (performance.now() < deadline) {
        const waitMs = step === 0 ? 1 : step === 1 ? 3 : 8;
        step++;
        await sleep(waitMs);
        const res = await this.frame.executeScript({
          code: `(() => { const r = window.__rbx && window.__rbx[${id}]; if (r && r.done) delete window.__rbx[${id}]; return JSON.stringify(r); })()`,
        });
        const raw = Array.isArray(res) ? res[0] : res;
        if (!raw || raw === "undefined") continue;
        let env;
        try {
          env = JSON.parse(raw);
        } catch (e) {
          continue;
        }
        if (!env || !env.done) continue;
        if (!env.ok) throw new Error(env.error);
        return env.value;
      }
      throw new Error("evalAsync timed out after " + timeoutMs + "ms");
    }

    async evalSync(code) {
      if (!IS_IWA || !this.frame) return null;
      const res = await this.frame.executeScript({ code });
      return Array.isArray(res) ? res[0] : res;
    }

    // ------------------------------------------------------------- login ----
    async whoami() {
      if (!IS_IWA) {
        const check = async () => {
          const r = await fetch("/api/rbx/whoami", { cache: "no-store" });
          if (!r.ok) return null;
          return await r.json();
        };
        let user = await check().catch(() => null);
        if (!user && document.documentElement.dataset.webloxExt === "1") {
          window.postMessage({ type: "WEBLOX_SYNC_EXT" }, "*");
          await sleep(160);
          user = await check().catch(() => null);
        }
        return user || null;
      }

      const out = await this.evalAsync(`
        const r = await fetch('https://users.roblox.com/v1/users/authenticated', { credentials: 'include' });
        if (r.status !== 200) return null;
        const u = await r.json();
        return { id: u.id, name: u.name, displayName: u.displayName };
      `, 6000);
      return out || null;
    }

    async injectCookie(value) {
      if (!value) throw new Error("empty cookie");
      if (!IS_IWA) {
        const r = await fetch("/api/rbx/cookie", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cookie: value }),
        });
        const doc = await r.json().catch(() => ({}));
        if (!doc || !doc.ok || !doc.user) {
          throw new Error(doc.error || "cookie rejected");
        }
        this.log(`logged in as ${doc.user.name} (${doc.user.id})`);
        return doc.user;
      }

      const literal = JSON.stringify(".ROBLOSECURITY=" + value + "; domain=.roblox.com; path=/; secure; samesite=lax");
      await this.evalAsync(`document.cookie = ${literal}; return true;`);
      const who = await this.whoami();
      if (!who) throw new Error("cookie rejected");
      this.log(`logged in as ${who.name} (${who.id})`);
      return who;
    }

    // -------------------------------------------------------------- join ----
    async join(placeId) {
      const place = Number(placeId) || 0;
      if (!IS_IWA) {
        const r = await fetch("/api/rbx/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ placeId: place }),
        });
        const script = await r.json();
        if (!r.ok || script.error) {
          throw new Error(script.error || `HTTP ${r.status}`);
        }
        this.lastJoinReply = script.rawReply || null;
        this.lastJoinScript = script.script || null;
        this.log(
          `joined ${script.udmux?.Address}:${script.udmux?.Port} via ${script.tries} retr${script.tries === 1 ? "y" : "ies"}`
        );
        return script;
      }

      if (!this.frame) throw new Error("frame not started");
      const script = await this.evalAsync(`
        const post = (jobId) => fetch('${GAMEJOIN}', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({
            placeId: ${place},
            isTeleport: false,
            gameJoinAttemptId: crypto.randomUUID(),
            browserTrackerId: 0,
            playSessionId: crypto.randomUUID(),
            eventId: crypto.randomUUID(),
            launchData: '',
            joinAttemptOrigin: 'PlayButton'
          }, jobId ? { jobId } : {}))
        }).then(r => r.json());

        let reply = await post(null);
        let tries = 0;
        while (reply.status === 0 && tries++ < 50) {
          await new Promise(r => setTimeout(r, 60));
          reply = await post(null);
        }
        if (reply.status !== 2) {
          throw new Error('join status ' + reply.status + ' ' + (reply.message || ''));
        }

        let s = reply.joinScript;
        if (!s || typeof s !== 'object') {
          const again = await post(reply.jobId);
          if (again && typeof again === 'object') {
            if (again.joinScript && typeof again.joinScript === 'object') {
              s = again.joinScript;
            }
            reply = Object.assign({}, reply, again);
          }
        }
        if (!s || typeof s !== 'object') throw new Error('join script missing');
        reply.status = 2;
        reply.joinScript = s;
        if (!reply.joinScriptUrl) {
          reply.joinScriptUrl = 'https://assetgame.roblox.com/Game/Join.ashx?placeId=' + ${place} + '&jobId=' + encodeURIComponent(reply.jobId || '');
        }

        return {
          jobId: reply.jobId,
          tries,
          userId: s.UserId,
          userName: s.UserName,
          machine: s.MachineAddress,
          serverPort: s.ServerPort,
          udmux: (s.UdmuxEndpoints || [])[0] || null,
          connections: s.ServerConnections || null,
          token: s.TokenValue,
          pepper: s.PepperId,
          clientTicket: s.ClientTicket,
          gameId: s.GameId,
          placeId: s.PlaceId,
          script: s,
          rawReply: reply
        };
      `, 30000);
      this.lastJoinReply = script.rawReply || null;
      this.lastJoinScript = script.script || null;
      this.log(`joined ${script.udmux?.Address}:${script.udmux?.Port} via ${script.tries} retr${script.tries === 1 ? "y" : "ies"}`);
      return script;
    }

    // ------------------------------------------------------------ bridge ----
    async request(url, init = {}) {
      if (/^https:\/\/gamejoin\.roblox\.com\/v[12]\/join-/i.test(url)) {
        if (this.pendingJoinPromise) {
          try { await this.pendingJoinPromise; } catch (e) {}
        }
        if (this.lastJoinReply) {
          this.log(`serving cached join-game response (status=2, jobId=${this.lastJoinReply.jobId})`);
          return {
            status: 200,
            url,
            headers: { "content-type": "application/json; charset=utf-8" },
            body: utf8ToB64(JSON.stringify(this.lastJoinReply)),
          };
        }
      }

      if (/\/Game\/Join\.ashx/i.test(url)) {
        if (this.pendingJoinPromise) {
          try { await this.pendingJoinPromise; } catch (e) {}
        }
        if (this.lastJoinScript) {
          this.log("serving cached Join.ashx script");
          return {
            status: 200,
            url,
            headers: { "content-type": "application/json; charset=utf-8" },
            body: utf8ToB64(JSON.stringify(this.lastJoinScript)),
          };
        }
      }

      if (!IS_IWA) {
        const r = await fetch("/api/rbx/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, ...init }),
        });
        if (!r.ok) {
          throw new Error(`Proxy HTTP ${r.status} for ${url}`);
        }
        return await r.json();
      }

      const cfg = JSON.stringify({ url, ...init });
      return this.evalAsync(`
        const c = ${cfg};
        let body = c.body != null ? c.body : undefined;
        if (c.bodyB64) {
          const bin = atob(c.bodyB64);
          body = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) body[i] = bin.charCodeAt(i);
        }
        const rawHeaders = c.headers || {};
        const safeHeaders = {};
        for (const [k, v] of Object.entries(rawHeaders)) {
          const lk = k.toLowerCase();
          if (lk === 'content-type' || lk === 'accept' || lk === 'x-csrf-token') {
            safeHeaders[k] = v;
          }
        }
        const send = (credentials) => fetch(c.url, {
          method: c.method || 'GET',
          credentials,
          headers: safeHeaders,
          body,
          redirect: c.redirect || 'follow'
        });
        let r;
        const isCdn = /\\.rbxcdn\\.com\\//i.test(c.url);
        if (isCdn) {
          r = await send('omit');
        } else {
          try {
            r = await send('include');
          } catch (e1) {
            try {
              r = await send('omit');
            } catch (e2) {
              throw new Error(c.url + ': ' + e2.message);
            }
          }
        }
        const buf = await r.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let b64 = '';
        const CH = 0x8000;
        for (let i = 0; i < bytes.length; i += CH) {
          b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
        }
        return {
          status: r.status,
          url: r.url,
          headers: Object.fromEntries(r.headers.entries()),
          body: btoa(b64)
        };
      `, 60000);
    }

    visible(on, topOffsetPx = 0) {
      const topbar = document.getElementById("rbx-topbar");
      if (topbar) {
        topbar.style.display = on ? "none" : "grid";
      }
      if (!IS_IWA) {
        this._ensureWebOverlay();
        if (this.overlay) {
          this.overlay.style.top = "0";
          this.overlay.style.left = "0";
          this.overlay.style.width = "100vw";
          this.overlay.style.height = "100vh";
          this.overlay.style.display = on ? "flex" : "none";
        }
        if (!on && this.loginPopup && !this.loginPopup.closed) {
          try { this.loginPopup.close(); } catch (e) {}
          this.loginPopup = null;
        }
        return;
      }

      if (!this.frame) return;
      if (on) {
        this.frame.style.top = topOffsetPx ? `${topOffsetPx}px` : "0";
        this.frame.style.height = topOffsetPx ? `calc(100% - ${topOffsetPx}px)` : "100%";
        this.frame.style.opacity = "1";
        this.frame.style.pointerEvents = "auto";
        this.frame.style.zIndex = "200";
      } else {
        this.frame.style.opacity = "0";
        this.frame.style.pointerEvents = "none";
        this.frame.style.zIndex = "-1";
      }
    }

    navigate(url) {
      if (!IS_IWA) {
        if (url) location.href = url;
        return;
      }
      if (this.frame && url) {
        this.frame.setAttribute("src", url);
      }
    }

    async fetchJson(url) {
      if (!IS_IWA) {
        try {
          const res = await this.request(url, { method: "GET" });
          if (!res || res.status < 200 || res.status >= 300 || !res.body) return null;
          return JSON.parse(b64ToUtf8(res.body));
        } catch (e) {
          return null;
        }
      }

      return this.evalAsync(`
        const r = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
        if (!r.ok) return null;
        return await r.json();
      `, 15000).catch(() => null);
    }

    async postJson(url, payload) {
      if (!IS_IWA) {
        try {
          const res = await this.request(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload || {}),
          });
          if (!res || res.status < 200 || res.status >= 300 || !res.body) return null;
          return JSON.parse(b64ToUtf8(res.body));
        } catch (e) {
          return null;
        }
      }

      return this.evalAsync(`
        const r = await fetch(${JSON.stringify(url)}, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(${JSON.stringify(payload || {})})
        });
        if (!r.ok) return null;
        return await r.json();
      `, 15000).catch(() => null);
    }

    async interactiveLogin(timeoutMs = 15 * 60 * 1000, topOffsetPx = 0) {
      if (!IS_IWA) {
        this.visible(true, topOffsetPx);
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          const who = await this.whoami().catch(() => null);
          if (who) {
            this.visible(false);
            return who;
          }
          await sleep(600);
        }
        throw new Error("login timed out");
      }

      this.navigate("https://www.roblox.com/login");
      this.visible(true, topOffsetPx);
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
        const who = await this.whoami().catch(() => null);
        if (who) {
          this.visible(false);
          return who;
        }
        await sleep(600);
      }
      throw new Error("login timed out");
    }

    async logout() {
      if (!IS_IWA) {
        try {
          window.postMessage({ type: "WEBLOX_LOGOUT_EXT" }, "*");
        } catch (e) {}
        try {
          await fetch("/api/rbx/logout", { method: "POST" });
        } catch (e) {}
        await sleep(250);
        this.lastJoinReply = null;
        this.lastJoinScript = null;
        this.pendingJoinPromise = null;
        this.log("logged out");
        return;
      }

      if (this.frame) {
        try {
          await this.evalAsync(`
            try {
              const r1 = await fetch('https://auth.roblox.com/v2/logout', { method: 'POST', credentials: 'include' });
              const csrf = r1.headers.get('x-csrf-token');
              if (csrf) {
                await fetch('https://auth.roblox.com/v2/logout', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'X-CSRF-TOKEN': csrf }
                });
              }
            } catch (e) {}
            document.cookie = ".ROBLOSECURITY=; domain=.roblox.com; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; secure";
            return true;
          `, 4000);
        } catch (e) {}
        try {
          await this.frame.clearData(
            { since: 0 },
            {
              cookies: true,
              sessionCookies: true,
              persistentCookies: true,
              localStorage: true,
              indexedDB: true,
            }
          );
        } catch (e) {}
      }
      this.lastJoinReply = null;
      this.lastJoinScript = null;
      this.pendingJoinPromise = null;
      this.log("logged out and cleared frame data");
    }
  }

  window.RobloxAuth = RobloxAuth;
})();
