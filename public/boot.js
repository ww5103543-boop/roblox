// boot.js — the globals the engine loader expects before it runs, plus the one
// line the IWA policy forces on us.

// Suppress internal Roblox engine startup spam, benign settings warnings, and routine logs
(function () {
  try {
    const _pats = [
      "[DIRECT KEY]",
      "[Direct Mouse",
      "DIRECT KEY",
      "Direct Mouse",
      "Tick ",
      "(input drops total:",
      " created",
      "[channel]",
      "[wasm-cors]",
      "Wrap-deformer",
      "Hidden Surface Removal",
      "texParameter",
      "INVALID_OPERATION",
      "Gamepad API",
      "isTouchDevice",
      "isTouchScreenDevice",
      "isKeyboardDevice",
      "isMouseDevice",
      "initialize returned",
      "launchUGCGame",
      "[FMOD]",
      "touchOnly",
      "Canvas:",
      "main loop",
      "[LIFECYCLE]",
      "serving cached join-game response",
      "Replicator created",
      "Time taken to initialize schema",
      "Assigned peer id",
      "[onServiceProvider]",
      "Join snapshot timer",
      "OTAPollingEnabled",
      "ClientWeatherBootstrapper",
      "Server RobloxGitHash",
      "Server Prefix",
      "[_UniversalAppPatch]",
      "[_InExperiencePatch]",
      "STARTING EMOTE",
      "com_outfits_exp_grp",
      "Notifications when exceeding max accessories",
      "asset_button_options_layout",
      "Successfully Loaded Catalog",
      "Welcome to Catalog Avatar Creator",
      "Recommended Community Outfits",
      "GetBatchItemDetails",
      "429 Too Many Requests",
      "Too Many Requests",
      "MeshContentProvider",
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
      "pixel ratio change observed",
      "GetServerChannelRemote not available",
      "Cache clean process failed to get available space",
      "Function not implemented",
      "PeerMonotonicClock",
      "DisplayCatalogPages ProjectedItems",
      "DraggableNPCVPF",
      "WorldModel.NPC.Animate",
      "WorldModel.Player.Animate",
      "FeaturedAnimationPackRenderTile",
      "SavedOutfitsV3",
      "CommunityOutfits",
      "CatalogGUI",
      "$func",
      "@ WebClient.wasm",
      "Temporary Id found in HSR data",
      "Mesh Id does not match",
      "Asset (Animation)",
      "Animation failed to load",
      "AssetResolutionWorkflow",
      "AssetDelivery403InvalidPermission",
      "User is not authorized to access Asset",
      "Error caught by React",
      "SquadsCore",
      "installReducer",
      "status:429"
    ];
    const _shouldSuppress = (args) => {
      if (!args || args.length === 0) return true;
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (typeof a === "string") {
          const s = a.trim();
          if (!s) return true;
          if (s === "created" || s.endsWith("created")) return true;
          if (s.startsWith("[DIRECT KEY]") || s.includes("[DIRECT KEY]") || s.includes("DIRECT KEY")) return true;
          if (s.startsWith("[Direct Mouse") || s.includes("Direct Mouse")) return true;
          if (s.startsWith("Tick ") && s.includes("took")) return true;
          if (s.length <= 2 && /^[wasdWASD0-9\-_]+$/.test(s)) return true;
          if (/^(starting|started)\b/i.test(s) && !s.includes("[auth]") && !s.includes("[rkring]")) return true;
          if (s.includes("w (error)") || s.includes("w(error)")) return true;
          for (let j = 0; j < _pats.length; j++) {
            if (s.includes(_pats[j])) return true;
          }
        } else if (a && typeof a === "object") {
          const m = ((a.message || a.error || a.reason || "") + "").trim();
          if (!m) continue;
          if (m.startsWith("[DIRECT KEY]") || m.includes("DIRECT KEY")) return true;
          if (m.startsWith("[Direct Mouse") || m.includes("Direct Mouse")) return true;
          if (m.startsWith("Tick ") && m.includes("took")) return true;
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
