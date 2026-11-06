// stub.js — the worker entry the loader builds from `workerStubUrl`.
//
// WasmPlayer points this at stub.js with `?src=<glue>`, and the glue carries
// tools/worker-prelude.js in front of it, which is what installs rbx-net.js in
// the worker. The policy here is the worker's own realm: a Trusted Types policy
// does not cross realms, and importScripts is a sink in this one.
;
(function () {
  try {
    delete self.WebTransport;
    delete globalThis.WebTransport;
  } catch (e) {}
  try {
    Object.defineProperty(self, "WebTransport", {
      value: undefined,
      writable: false,
      configurable: true,
    });
  } catch (e) {}
  try {
    Object.defineProperty(globalThis, "WebTransport", {
      value: undefined,
      writable: false,
      configurable: true,
    });
  } catch (e) {}

  if (typeof trustedTypes !== "undefined") {
    try {
      trustedTypes.createPolicy("default", { createScriptURL: (url) => url });
    } catch (e) {
      // already defined
    }
  }
  const src = new URL(location.href).searchParams.get("src");
  importScripts(src || location.origin + "/engine/WebClient.js");
})();
