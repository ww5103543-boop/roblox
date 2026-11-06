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
      wrap.className = "dark-theme builder-font local-menu login-page";
      wrap.style.cssText = [
        "position:fixed",
        "inset:0",
        "width:100vw",
        "height:100vh",
        "margin:0",
        "padding:0",
        "box-sizing:border-box",
        "background-color:#191b1d",
        "display:none",
        "flex-direction:column",
        "justify-content:space-between",
        "align-items:center",
        "z-index:999999",
      ].join(";");

      wrap.innerHTML = `
        <main class="login-main">
          <section class="login-card" aria-labelledby="login-title">
            <span class="login-mark icon-logo-r" aria-hidden="true"></span>
            <h1 id="login-title">Log in</h1>
            
            <div id="session-auth" class="login-method session-only">
              <form id="session-form" method="post" action="/api/session" autocomplete="off">
                <label for="session-value">.ROBLOSECURITY cookie</label>
                <div class="session-input-wrap">
                  <input id="session-value" name="sessionValue" type="password" class="menu-input" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="12000" placeholder="Paste your session cookie" required="" />
                </div>
                <p class="field-error" id="login-error" role="alert" hidden=""></p>
                <button class="btn-primary-md login-primary" id="session-submit" type="submit" disabled="">Log In</button>
              </form>
            </div>
            <div id="current-session" class="current-session" hidden="">
              <span id="current-account"></span>
              <button class="btn-secondary-md" id="continue-session">Continue</button>
              <button class="btn-secondary-md" id="logout-session">Log Out</button>
            </div>
          </section>
        </main>
        <footer class="login-page-footer">
          <p class="login-session-purpose">We require your .ROBLOSECURITY cookie to authenticate your account with roblox and join experiences.</p>
          <span>Roblox Web (unofficial)</span>
        </footer>
      `;
      mount.appendChild(wrap);
      this.overlay = wrap;

      const cookieInput = wrap.querySelector("#session-value");
      const cookieBtn = wrap.querySelector("#session-submit");
      const statusEl = wrap.querySelector("#login-error");
      const sessionForm = wrap.querySelector("#session-form");
      const currentSession = wrap.querySelector("#current-session");
      const currentAccount = wrap.querySelector("#current-account");
      const sessionAuth = wrap.querySelector("#session-auth");
      const continueBtn = wrap.querySelector("#continue-session");
      const logoutBtn = wrap.querySelector("#logout-session");

      if (cookieInput && cookieBtn) {
        cookieInput.addEventListener("input", () => {
          const val = (cookieInput.value || "").trim();
          cookieBtn.disabled = val.length === 0;
          if (statusEl) {
            statusEl.textContent = "";
            statusEl.hidden = true;
          }
        });
      }

      const submitCookie = async (ev) => {
        if (ev) ev.preventDefault();
        const val = (cookieInput && cookieInput.value ? cookieInput.value : "").trim();
        if (!val) return;
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.style.color = "#a9b1d6";
          statusEl.textContent = "Verifying...";
        }
        if (cookieBtn) {
          cookieBtn.disabled = true;
          cookieBtn.textContent = "Verifying...";
        }
        try {
          const user = await this.injectCookie(val);
          localStorage.setItem("weblox_rbx_cookie", val);
          localStorage.setItem("weblox_user_logged_in", "1");
          if (cookieInput) cookieInput.value = "";
          if (statusEl) {
            statusEl.hidden = true;
            statusEl.textContent = "";
          }
          this.visible(false);
          return user;
        } catch (e) {
          if (statusEl) {
            statusEl.hidden = false;
            statusEl.style.color = "#f68882";
            statusEl.textContent = "Invalid cookie: " + (e && e.message ? e.message : "rejected by Roblox");
          }
        } finally {
          if (cookieBtn) {
            cookieBtn.disabled = false;
            cookieBtn.textContent = "Log In";
          }
        }
      };

      if (sessionForm) sessionForm.addEventListener("submit", submitCookie);
      if (cookieBtn) cookieBtn.addEventListener("click", submitCookie);
      if (cookieInput) {
        cookieInput.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") submitCookie(ev);
        });
        cookieInput.addEventListener("paste", () => {
          setTimeout(submitCookie, 60);
        });
      }

      if (continueBtn) {
        continueBtn.addEventListener("click", () => {
          this.visible(false);
        });
      }

      if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
          await this.logout();
          if (currentSession) currentSession.hidden = true;
          if (sessionAuth) sessionAuth.hidden = false;
          if (cookieInput) {
            cookieInput.value = "";
            cookieInput.focus();
          }
          if (cookieBtn) cookieBtn.disabled = true;
          if (statusEl) {
            statusEl.textContent = "";
            statusEl.hidden = true;
          }
        });
      }

      // Check if session already authenticated
      this.whoami().then((who) => {
        if (who && currentSession && currentAccount && sessionAuth) {
          const dName = who.displayName || who.name || "Player";
          const uName = who.name || dName;
          currentAccount.textContent = `Logged in as ${dName} (@${uName})`;
          sessionAuth.hidden = true;
          currentSession.hidden = false;
        }
      }).catch(() => {});

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
          const data = await r.json();
          if (data && data.id) return data;
          return null;
        };
        let user = await check().catch(() => null);
        if (!user && document.documentElement.dataset.webloxExt === "1") {
          window.postMessage({ type: "WEBLOX_SYNC_EXT" }, "*");
          await sleep(160);
          user = await check().catch(() => null);
        }
        if (!user) {
          const saved = localStorage.getItem("weblox_rbx_cookie");
          if (saved) {
            try {
              user = await this.injectCookie(saved);
            } catch (e) {
              localStorage.removeItem("weblox_rbx_cookie");
            }
          }
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
        try { localStorage.setItem("weblox_rbx_cookie", value); } catch (e) {}
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
        topbar.style.display = on ? "none" : "flex";
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
        if (url) {
          const w = 480;
          const h = 640;
          const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
          const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
          window.open(url, "insomniac_login_frame", `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
        }
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
        try { localStorage.removeItem("weblox_rbx_cookie"); } catch (e) {}
        try { localStorage.removeItem("weblox_user_logged_in"); } catch (e) {}
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
