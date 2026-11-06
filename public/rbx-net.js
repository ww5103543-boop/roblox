// rbx-net.js — every roblox.com call, answered from the authenticated frame.
(() => {
  if (self.__rbxNet) return;
  self.__rbxNet = 1;

  const base = (typeof location !== "undefined" && location.origin) || "https://localhost";
  const isPage = typeof document !== "undefined";

  function hostOf(url) {
    try {
      return new URL(url, base).hostname;
    } catch (e) {
      return "";
    }
  }

  // Direct: hosts that do not want the cookie, and answer with
  // `access-control-allow-origin: *` so the app origin may read them directly.
  const DIRECT = new Set([
    "clientsettings.roblox.com",
    "clientsettingscdn.roblox.com",
    "contentdelivery.roblox.com",
  ]);

  // Telemetry beacons that are fire-and-forget; answering them immediately
  // avoids clogging BroadcastChannel and <controlledframe> during game join.
  const TELEMETRY = new Set([
    "ecsv2.roblox.com",
    "client-telemetry.roblox.com",
    "metrics.roblox.com",
    "ephemeralcounters.api.roblox.com",
    "lms.roblox.com",
    "tracers.roblox.com",
    "sentry-relay.rbxinfra.com",
    "sentry.io",
  ]);

  const isTelemetry = (url) => {
    if (!url) return false;
    const host = hostOf(url);
    if (TELEMETRY.has(host) || host.endsWith(".rbxinfra.com")) return true;
    if (typeof url === "string" && (
      url.includes("/experience-signals-ingest/") ||
      url.includes("/telemetry/") ||
      url.includes("/envelope/") ||
      url.includes("/api/29/store/") ||
      url.includes("/api/26/store/")
    )) return true;
    return false;
  };

  const isRoblox = (url) => {
    const host = hostOf(url);
    if (DIRECT.has(host)) return false;
    return host === "roblox.com" || host.endsWith(".roblox.com");
  };

  // ------------------------------------------------------------ transport ---
  const CHANNEL_NAME = "rbxnet";
  let channel = null;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch (e) { }
  }

  let seq = 0;
  const waiting = new Map(); // id -> resolve

  if (channel) {
    channel.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg) return;
      if (msg.kind === "req" && isPage && self.__rbxAuth) {
        self.__rbxAuth
          .request(msg.url, msg.init)
          .then((res) => {
            note(msg.url, msg.init && msg.init.method, res.status, "worker");
            channel.postMessage({ kind: "res", id: msg.id, res });
          })
          .catch((e) => {
            note(msg.url, msg.init && msg.init.method, 0, "worker", e && e.message);
            channel.postMessage({ kind: "res", id: msg.id, error: String(e) });
          });
      } else if (msg.kind === "res") {
        const resolve = waiting.get(msg.id);
        if (resolve) {
          waiting.delete(msg.id);
          resolve(msg);
        }
      }
    };
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToB64(bytes) {
    let bin = "";
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }

  /** Normalise a fetch init into something structured-cloneable. */
  async function encodeInit(init = {}) {
    const out = {
      method: init.method || "GET",
      headers: {},
      redirect: init.redirect || "follow",
    };
    const h = new Headers(init.headers || {});
    for (const [k, v] of h) out.headers[k] = v;
    let body = init.body;
    if (body == null) return out;
    if (typeof body === "string") {
      out.body = body;
    } else if (body instanceof URLSearchParams) {
      out.body = body.toString();
      out.headers["content-type"] = out.headers["content-type"] || "application/x-www-form-urlencoded;charset=UTF-8";
    } else if (body instanceof Blob) {
      out.body = await body.text();
    } else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
      const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
      out.bodyB64 = bytesToB64(bytes);
      out.body = "";
    } else {
      out.body = String(body);
    }
    return out;
  }

  function viaChannel(url, init) {
    if (!channel) return Promise.reject(new Error("no BroadcastChannel for " + url));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      waiting.set(id, (msg) => {
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.res);
      });
      channel.postMessage({ kind: "req", id, url, init });
    });
  }

  // ------------------------------------------------------------ telemetry ---
  const recent = [];
  if (typeof self !== "undefined") self.__rbxNetLog = recent;

  function note(url, method, status, via, error) {
    const entry = { url: String(url), method: method || "GET", status: status | 0, via: via || "page" };
    if (error) entry.error = String(error);
    recent.push(entry);
    if (recent.length > 300) recent.shift();
  }

  const _catalogCache = new Map();

  async function rbxRequest(url, init) {
    if (isTelemetry(url)) {
      return { status: 200, url, headers: { "content-type": "application/json" }, body: "e30=" };
    }
    const isCatalog = url.includes("catalog.roblox.com");
    let cacheKey = "";
    if (isCatalog) {
      cacheKey = url + "|" + (init && init.body ? String(init.body) : "");
      const cached = _catalogCache.get(cacheKey);
      if (cached && (Date.now() - cached.time < 60000)) {
        return cached.res;
      }
    }
    const encoded = await encodeInit(init);
    let res;
    try {
      const isJoinUrl = /^https:\/\/gamejoin\.roblox\.com\/v[12]\/join-/i.test(url) || /\/Game\/Join\.ashx/i.test(url);
      if (isPage && self.__rbxAuth) {
        res = await self.__rbxAuth.request(url, encoded);
      } else if (!isJoinUrl && typeof location !== "undefined" && location.protocol !== "isolated-app:") {
        const r = await origFetch.call(self, "/api/rbx/request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url, ...encoded }),
        });
        if (!r.ok) throw new Error("Proxy HTTP " + r.status);
        res = await r.json();
      } else {
        res = await viaChannel(url, encoded);
      }
    } catch (e) {
      if (isCatalog) {
        const cached = _catalogCache.get(cacheKey);
        if (cached) return cached.res;
        return { status: 200, url, headers: { "content-type": "application/json" }, body: btoa(JSON.stringify({ data: [] })) };
      }
      note(url, encoded.method, 0, isPage ? "page" : "worker", e && e.message);
      throw e;
    }
    if (isCatalog) {
      if (res.status === 200) {
        _catalogCache.set(cacheKey, { res, time: Date.now() });
      } else if (res.status === 429) {
        const cached = _catalogCache.get(cacheKey);
        if (cached) return cached.res;
        res = { status: 200, url, headers: { "content-type": "application/json" }, body: btoa(JSON.stringify({ data: [] })) };
      }
    }
    note(url, encoded.method, res.status, isPage ? "page" : "worker");
    return res;
  }

  function toResponse(res) {
    const headers = new Headers(res.headers || {});
    const bytes = res.body ? b64ToBytes(res.body) : new Uint8Array(0);
    const nullBody = bytes.length === 0 || res.status === 204 || res.status === 205 || res.status === 304;
    return new Response(nullBody ? null : bytes, { status: res.status, statusText: "", headers });
  }

  // --------------------------------------------------------------- patch ----
  const SETTINGS_RE = /^https:\/\/clientsettings(cdn)?\.roblox\.com\/v2\/settings\/application\/WebClientApp/;

  async function settingsOverride(url, init) {
    const r = await origFetch.call(self, url, { ...(init || {}), credentials: "omit" });
    let doc;
    try {
      doc = await r.json();
    } catch (e) {
      return r;
    }
    const app = doc.applicationSettings;
    if (app) {
      app.FFlagUseRbxTransportClient3 = "False";
      app.FFlagUseRbxTransportServer = "False";
      app.DFFlagEnableReactiveGameJoin3 = "False";
      app.DFFlagEnableReactiveGameJoin4 = "False";
      app.DFIntRbxStorageInitHundredthsPercent = "0";
      app.DFIntRbxStorageErrorLogHundredthsPercent = "0";
      app.FLogLocalStorage = "0";
      app.FFlagForceEnableSquad = "False";
      app.FFlagIsSquadLobbySessionEnabled = "False";
      app.FLogGameJoinUtil = "7";
      app.FLogGameJoinV2 = "7";
      app.FLogUgcExperienceController = "7";
    }
    console.log("[rbxnet] Network mode: RakNet UDP over WS-UDP active (status " + r.status + ")");
    return new Response(JSON.stringify(doc), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  }

  function uncredentialed(init) {
    const out = { ...(init || {}) };
    out.credentials = "omit";
    if (out.headers) {
      const clean = {};
      const h = new Headers(out.headers);
      for (const [k, v] of h) {
        const lk = k.toLowerCase();
        if (lk === "accept" || lk === "accept-language" || lk === "content-language" || lk === "content-type") {
          clean[k] = v;
        }
      }
      out.headers = clean;
    }
    return out;
  }

  const looksLikeAsset = (url) => {
    const host = hostOf(url);
    return DIRECT.has(host) || host.endsWith(".rbxcdn.com");
  };

  const origFetch = self.fetch;
  self.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    if (url && isTelemetry(url)) {
      return Promise.resolve(new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" }
      }));
    }
    if (url && SETTINGS_RE.test(new URL(url, base).href)) return settingsOverride(new URL(url, base).href, init);
    if (!url || !isRoblox(url)) {
      const pass = init || undefined;
      if (url && looksLikeAsset(url)) {
        const opts = uncredentialed(pass);
        return origFetch.call(self, input, opts).then((res) => {
          note(url, opts.method, res.status, "direct");
          return res;
        });
      }
      return origFetch.call(self, input, pass);
    }
    const opts = init || (input && input.url && !(input instanceof Request) ? undefined : input);
    const run = input instanceof Request && !init ? input.text().then((text) => ({ ...(opts || {}), body: text })) : Promise.resolve(opts || {});
    return run.then((o) => rbxRequest(new URL(url, base).href, o)).then(toResponse);
  };

  const OrigXHR = self.XMLHttpRequest;
  if (OrigXHR) {
    class FrameXHR extends EventTarget {
      constructor() {
        super();
        this.readyState = 0;
        this.status = 0;
        this.statusText = "";
        this.response = null;
        this.responseText = "";
        this.responseURL = "";
        this.responseXML = null;
        this.responseType = "";
        this.withCredentials = false;
        this.timeout = 0;
        this._headers = {};
        this._resHeaders = new Headers();
        this._aborted = false;
        this.onload = null;
        this.onerror = null;
        this.onreadystatechange = null;
        this.ontimeout = null;
        this.onprogress = null;
      }

      open(method, url) {
        this._method = method;
        this._url = new URL(url, base).href;
        this._telemetry = isTelemetry(this._url);
        this._robox = this._telemetry || isRoblox(this._url);
        if (!this._robox) {
          this._real = new OrigXHR();
          const real = this._real;
          real.onreadystatechange = () => this._syncFromReal();
          real.onerror = () => this._fail();
          real.ontimeout = () => this._fire("timeout");
          real.onprogress = (e) => this._fire("progress");
          real.open(...arguments);
          return;
        }
        this.readyState = 1;
        this._fire("readystatechange");
      }

      setRequestHeader(k, v) {
        if (this._real) {
          const lk = String(k).toLowerCase();
          if (looksLikeAsset(this._url) && lk !== "accept" && lk !== "content-type" && lk !== "range") {
            return;
          }
          return this._real.setRequestHeader(k, v);
        }
        this._headers[k] = v;
      }

      getResponseHeader(k) {
        if (this._real) return this._real.getResponseHeader(k);
        return this._resHeaders.get(k);
      }

      getAllResponseHeaders() {
        if (this._real) return this._real.getAllResponseHeaders();
        return [...this._resHeaders].map(([k, v]) => `${k}: ${v}`).join("\r\n");
      }

      overrideMimeType() { }

      abort() {
        this._aborted = true;
        if (this._real) this._real.abort();
      }

      send(body) {
        if (this._real) {
          const real = this._real;
          real.responseType = this.responseType;
          real.timeout = this.timeout;
          real.withCredentials = looksLikeAsset(this._url) ? false : this.withCredentials;
          return real.send(body);
        }
        rbxRequest(this._url, { method: this._method || "GET", headers: this._headers, body })
          .then((res) => {
            if (this._aborted) return;
            const bytes = res.body ? b64ToBytes(res.body) : new Uint8Array(0);
            this.status = res.status;
            this.responseURL = res.url || this._url;
            this._resHeaders = new Headers(res.headers || {});
            this.readyState = 2;
            this._fire("readystatechange");
            this.readyState = 4;
            if (this.responseType === "arraybuffer") this.response = bytes.buffer;
            else if (this.responseType === "blob") this.response = new Blob([bytes]);
            else {
              this.responseText = new TextDecoder().decode(bytes);
              this.response = this.responseText;
            }
            this._fire("readystatechange");
            this._fire("load");
          })
          .catch((e) => this._fail(e));
      }

      _syncFromReal() {
        const r = this._real;
        this.readyState = r.readyState;
        this.status = r.status;
        this.statusText = r.statusText;
        this.responseURL = r.responseURL || this._url;
        this.response = r.response;
        try {
          this.responseText = r.responseType === "" || r.responseType === "text" ? r.responseText : "";
        } catch (e) {
          this.responseText = "";
        }
        this._fire("readystatechange");
        if (r.readyState === 4) this._fire("load");
      }

      _fail(e) {
        this.readyState = 4;
        this.status = 0;
        if (typeof this.onerror === "function") this.onerror(e || { target: this });
      }

      _fire(type) {
        const ev = new Event(type);
        this.dispatchEvent(ev);
        const handler = this["on" + type];
        if (typeof handler === "function") handler.call(this, ev);
      }
    }
    for (const k of ["UNSENT", "OPENED", "HEADERS_RECEIVED", "LOADING", "DONE"]) {
      FrameXHR[k] = OrigXHR[k];
    }
    FrameXHR.prototype.UNSENT = 0;
    FrameXHR.prototype.OPENED = 1;
    FrameXHR.prototype.HEADERS_RECEIVED = 2;
    FrameXHR.prototype.LOADING = 3;
    FrameXHR.prototype.DONE = 4;
    self.XMLHttpRequest = FrameXHR;
  }

  // ---------------------------------------------------------------- images ---
  const CDN_RE = /^https?:\/\/([a-z0-9-]+\.)*rbxcdn\.com\//i;
  const blobs = new Map();
  if (typeof HTMLImageElement !== "undefined") {
    const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set(v) {
        const url = String(v);
        if (!CDN_RE.test(url)) return desc.set.call(this, url);
        const hit = blobs.get(url);
        if (hit) return desc.set.call(this, hit);
        origFetch
          .call(self, url, { mode: "cors", credentials: "omit" })
          .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("HTTP " + r.status))))
          .then((b) => {
            const blobUrl = URL.createObjectURL(b);
            blobs.set(url, blobUrl);
            if (blobs.size > 512) {
              const oldest = blobs.keys().next().value;
              URL.revokeObjectURL(blobs.get(oldest));
              blobs.delete(oldest);
            }
            desc.set.call(this, blobUrl);
          })
          .catch(() => desc.set.call(this, url));
      },
    });
  }

  self.__rbxNetRule = "*.roblox.com";
})();
