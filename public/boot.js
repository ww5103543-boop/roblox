// boot.js — the globals the engine loader expects before it runs, plus the one
// line the IWA policy forces on us.

window.__wasmLoaderContext = {
  engineBase: location.origin + "/engine",
  server: "prod",
  channel: null,
  workerStubUrl: location.origin + "/stub.js",
};

// Filter misleading Roblox internal engine logs that use "Critical" channel levels for routine startup logs
const _origWarn = console.warn;
console.warn = function (...args) {
  const msg = typeof args[0] === "string" ? args[0] : "";
  if (msg.includes("[DFLog::RbxStorage] RbxStorage::init")) {
    return console.debug(...args);
  }
  return _origWarn.apply(console, args);
};

const _origError = console.error;
console.error = function (...args) {
  const msg = typeof args[0] === "string" ? args[0] : "";
  if (msg.includes("[DFLog::RbxStorage] RbxStorage::init")) {
    return console.debug(...args);
  }
  return _origError.apply(console, args);
};

// require-trusted-types-for 'script' rejects a plain string on script.src,
// new Worker(...) and importScripts(). A policy named "default" is applied to
// every sink automatically, so no call site — ours or the engine's — has to
// know about it.
//
// It asserts nothing about the URL, which is the honest position: CSP already
// restricts scripts to 'self', and that is the check that actually holds.
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
