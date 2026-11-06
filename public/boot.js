// boot.js — the globals the engine loader expects before it runs, plus the one
// line the IWA policy forces on us.

// Suppress internal Roblox engine startup spam, benign settings warnings, and routine logs
(function () {
  try {
    const ALLOWED_EXACT_PREFIXES = [
      "[rkring] ring seam installed",
      "[app] WebClient.wasm precompiled in background",
      "Loading WasmPlayer: Engine Base URL is",
      "Loading WasmPlayer: Page Base URL is",
      "[auth]",
      "[rbxnet]",
      "[rkring] WS-UDP open",
    ];

    const _shouldSuppress = (args) => {
      if (!args || args.length === 0) return true;
      const first = args[0];
      let s = "";
      if (typeof first === "string") {
        s = first.trim();
      } else if (first && typeof first === "object") {
        s = ((first.message || first.error || first.reason || "") + "").trim();
      }
      if (!s) return true;

      // Allow only the clean high-level start logs
      for (let i = 0; i < ALLOWED_EXACT_PREFIXES.length; i++) {
        if (s.startsWith(ALLOWED_EXACT_PREFIXES[i])) {
          return false;
        }
      }
      return true;
    };

    window.__shouldSuppressLog = _shouldSuppress;
    const _ol = console.log, _ow = console.warn, _oe = console.error, _oi = console.info, _od = console.debug;
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
    console.debug = function (...args) {
      if (_shouldSuppress(args)) return;
      return _od.apply(console, args);
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
  const BINDING_MAP = {
    0x0DE1: 0x8069, // TEXTURE_2D -> TEXTURE_BINDING_2D
    0x8C1A: 0x8C1D, // TEXTURE_2D_ARRAY -> TEXTURE_BINDING_2D_ARRAY
    0x806F: 0x806A, // TEXTURE_3D -> TEXTURE_BINDING_3D
    0x8513: 0x8514  // TEXTURE_CUBE_MAP -> TEXTURE_BINDING_CUBE_MAP
  };
  function guardTexParams(proto) {
    if (!proto || !proto.texParameteri) return;
    const origTexParameteri = proto.texParameteri;
    const origTexParameterf = proto.texParameterf;
    proto.texParameteri = function (target, pname, param) {
      const q = BINDING_MAP[target];
      if (q) {
        try { if (!this.getParameter(q)) return; } catch (e) {}
      }
      return origTexParameteri.call(this, target, pname, param);
    };
    proto.texParameterf = function (target, pname, param) {
      const q = BINDING_MAP[target];
      if (q) {
        try { if (!this.getParameter(q)) return; } catch (e) {}
      }
      return origTexParameterf.call(this, target, pname, param);
    };
  }
  if (typeof WebGL2RenderingContext !== "undefined") guardTexParams(WebGL2RenderingContext.prototype);
  if (typeof WebGLRenderingContext !== "undefined") guardTexParams(WebGLRenderingContext.prototype);
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
