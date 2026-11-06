// boot.js — the globals the engine loader expects before it runs, plus the one
// line the IWA policy forces on us.

// Suppress internal Roblox engine startup spam, benign settings warnings, and routine logs
(function () {
  try {
    const _pats = [
      "[WASM-TIMING]",
      "[WASM-JSPI]",
      "[WASM-RNA]",
      "[FLog::",
      "[DFLog::",
      "[pthread]",
      "Available WebGL Extensions:",
      "- EXT_",
      "- OES_",
      "- WEBGL_",
      "- KHR_",
      "- NV_",
      "GL Vendor",
      "GLSL version",
      "Ext: ",
      "handleConnectErrorFromJs",
      "WebTransport",
      "WasmMultiplexedConnection",
      "All use of Roblox services must comply",
      "RobloxGitHash:",
      "The base url is",
      "The channel is",
      "Base URL:",
      "Base Host:",
      "Wasm Memory Bytes =",
      "Registered ",
      "No prefetch:",
      "heartbeat #",
      "Redirecting WebWorker",
      "audio-processor-fast.js",
      "WebClient.js",
      "Hello world",
      "Hello again",
      "RbxStorage",
      "UserGameSettings",
      "Squad.NetworkStatus",
      "useSquadState",
      "SettingsHub",
      "LocalStorageHandler",
      "LocalStorageManager",
      "Asset is not approved",
      "MeshContentProvider failed",
      "Synchronous JavaScript allocator",
      "rectBackgroundWhite",
      "Slider/Left",
      "Slider/Less",
      "DropDown/DropDown",
      "stream == nullptr",
      "Invalid image or texture",
      "[CookiePool]",
      "[IXP]",
      "[Flags]",
      "pixel ratio change observed"
    ];
    const _shouldSuppress = (args) => {
      if (!args || args.length === 0) return true;
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (typeof a === "string") {
          const s = a.trim();
          if (s.length <= 2 && /^[wasdWASD0-9\-_]+$/.test(s)) return true;
          if (/^(starting|started)\b/i.test(s) && !s.includes("[auth]") && !s.includes("[rkring]")) return true;
          if (s.includes("w (error)") || s.includes("w(error)")) return true;
          for (let j = 0; j < _pats.length; j++) {
            if (s.includes(_pats[j])) return true;
          }
        } else if (a && typeof a === "object") {
          const m = ((a.message || a.error || a.reason || "") + "").trim();
          if (m.length <= 2 && /^[wasdWASD0-9\-_]+$/.test(m)) return true;
          if (m.includes("w (error)") || m.includes("w(error)")) return true;
          for (let j = 0; j < _pats.length; j++) {
            if (m.includes(_pats[j])) return true;
          }
        }
      }
      return false;
    };
    window.__shouldSuppressLog = _shouldSuppress;
    const _ol = console.log, _ow = console.warn, _oe = console.error, _oi = console.info;
    console.log = function (...args) {
      if (_shouldSuppress(args)) return;
      return _ol.apply(console, args);
    };
    console.warn = function (...args) {
      if (_shouldSuppress(args)) return;
      return _ow.apply(console, args);
    };
    console.error = function (...args) {
      if (_shouldSuppress(args)) return;
      return _oe.apply(console, args);
    };
    console.info = function (...args) {
      if (_shouldSuppress(args)) return;
      return _oi.apply(console, args);
    };
  } catch (e) {}
})();

window.__wasmLoaderContext = {
  engineBase: location.origin + "/engine",
  server: "prod",
  channel: null,
  workerStubUrl: location.origin + "/stub.js",
};

// Ensure Roblox engine uses RakNet over UDP (via ring.js) instead of failing WebTransport (RNA)
try {
  delete window.WebTransport;
  delete globalThis.WebTransport;
} catch (e) {}
try {
  Object.defineProperty(window, "WebTransport", {
    value: undefined,
    writable: false,
    configurable: true,
  });
} catch (e) {
  window.WebTransport = undefined;
}
try {
  Object.defineProperty(globalThis, "WebTransport", {
    value: undefined,
    writable: false,
    configurable: true,
  });
} catch (e) {
  globalThis.WebTransport = undefined;
}

// Auto-resume AudioContext on user interaction so audio plays without warning
try {
  const _RealAudioContext = window.AudioContext || window.webkitAudioContext;
  if (_RealAudioContext) {
    const activeContexts = [];
    const resumeAll = () => {
      for (const ctx of activeContexts) {
        if (ctx.state === "suspended") {
          ctx.resume().catch(() => {});
        }
      }
    };
    ["click", "keydown", "pointerdown", "touchstart"].forEach((evt) => {
      window.addEventListener(evt, resumeAll, { passive: true, capture: true });
    });
    window.AudioContext = class extends _RealAudioContext {
      constructor(...args) {
        super(...args);
        activeContexts.push(this);
      }
    };
    if (window.webkitAudioContext) {
      window.webkitAudioContext = window.AudioContext;
    }
  }
} catch (e) {}

// Guard WebGL texParameter when no texture is bound to prevent INVALID_OPERATION warnings
try {
  if (typeof WebGL2RenderingContext !== "undefined") {
    const origBindTexture = WebGL2RenderingContext.prototype.bindTexture;
    const origTexParameteri = WebGL2RenderingContext.prototype.texParameteri;
    const origTexParameterf = WebGL2RenderingContext.prototype.texParameterf;

    WebGL2RenderingContext.prototype.bindTexture = function (target, texture) {
      this._boundTextures = this._boundTextures || new Map();
      this._boundTextures.set(target, texture);
      return origBindTexture.call(this, target, texture);
    };

    WebGL2RenderingContext.prototype.texParameteri = function (target, pname, param) {
      if (this._boundTextures && !this._boundTextures.get(target)) return;
      return origTexParameteri.call(this, target, pname, param);
    };

    WebGL2RenderingContext.prototype.texParameterf = function (target, pname, param) {
      if (this._boundTextures && !this._boundTextures.get(target)) return;
      return origTexParameterf.call(this, target, pname, param);
    };
  }
} catch (e) {}

// require-trusted-types-for 'script' rejects a plain string on script.src,
// new Worker(...) and importScripts(). A policy named "default" is applied to
// every sink automatically, so no call site — ours or the engine's — has to
// know about it.
if (typeof trustedTypes !== "undefined") {
  try {
    trustedTypes.createPolicy("default", {
      createScriptURL: (url) => url,
      createScript: (src) => src,
      createHTML: (html) => html,
    });
  } catch (e) {
    // A default policy already exists; nothing to add.
  }
}
