// ring.js — the datagram seam: works in a standard Chrome tab via WebSocket
// (`/__udp` on rkhost.py) and in an IWA via Direct Sockets (`UDPSocket`).
(() => {
  if (globalThis.__rkRing) return;

  const ABI = globalThis.__rkAbi;
  if (!ABI) throw new Error("ring ABI missing: /abi.js did not load");
  const at = (off) => ABI.base + off;
  const MAGIC = at(ABI.magic);
  const TX_HEAD = at(ABI.txHead);
  const TX_TAIL = at(ABI.txTail);
  const RX_HEAD = at(ABI.rxHead);
  const RX_TAIL = at(ABI.rxTail);
  const WAKE = at(ABI.wake); // futex word: page notifies, recv waits
  const SLOT = ABI.slot;
  const NSLOT = ABI.slots;
  const TX0 = at(ABI.tx0);
  const RX0 = at(ABI.rx0);
  const MAX_DATAGRAM = ABI.maxDatagram;
  const MAGIC_VALUE = 0x4b52414e; // 'RAKN'

  let mem = null, i32 = null, u8 = null, u32 = null;
  let socket = null, writer = null, reader = null;
  let ws = null;
  let rupp = null;
  let running = false;

  const stats = { tx: 0, rx: 0, dropRx: 0, txBytes: 0, rxBytes: 0, errors: 0, started: 0 };
  const log = (...a) => console.log("[rkring]", ...a);

  // ---------------------------------------------------------------- memory ---
  const RealMemory = WebAssembly.Memory;
  function Memory(desc) {
    const m = new RealMemory(desc);
    if (desc && desc.shared) attach(m);
    return m;
  }
  Memory.prototype = RealMemory.prototype;
  Object.setPrototypeOf(Memory, RealMemory);
  WebAssembly.Memory = Memory;

  function attach(m) {
    if (mem) return;
    mem = m;
    i32 = new Int32Array(m.buffer);
    u8 = new Uint8Array(m.buffer);
    u32 = new Uint32Array(m.buffer);
    Atomics.store(i32, MAGIC >> 2, MAGIC_VALUE);
    pumpLoop();
  }

  // ----------------------------------------------------------------- guest ---
  async function start({ host, port, script }) {
    if (!host || !port) throw new Error("ring.start needs host and port");
    rupp = new Rupp().setJoinScript(script);

    // Close any prior transport if switching servers
    if (ws) {
      try { ws.close(); } catch (e) {}
      ws = null;
    }
    if (socket) {
      try { socket.close(); } catch (e) {}
      socket = null;
      writer = null;
      reader = null;
    }
    running = false;

    if (typeof UDPSocket !== "undefined" && location.protocol === "isolated-app:") {
      socket = new UDPSocket({ remoteAddress: host, remotePort: port });
      const opened = await socket.opened;
      writer = opened.writable.getWriter();
      reader = opened.readable.getReader();
      running = true;
      stats.started++;
      stats.localPort = opened.localPort;
      log(`UDPSocket open -> ${host}:${port} local ${opened.localPort}`);
      readLoop();
      return snapshot();
    }

    // Standard browser tab / website mode: connect via server.py WebSocket UDP bridge
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${location.host}/__udp?host=${encodeURIComponent(host)}&port=${Number(port)}`;

    const connectWs = () => new Promise((resolve, reject) => {
      const sock = new WebSocket(wsUrl);
      sock.binaryType = "arraybuffer";
      let settled = false;

      sock.onopen = () => {
        ws = sock;
        running = true;
        stats.started++;
        stats.localPort = 0;
        log(`WS-UDP open -> ${host}:${port}`);
        if (!settled) {
          settled = true;
          resolve(sock);
        }
      };

      sock.onmessage = (ev) => {
        if (!ev.data) return;
        const data = new Uint8Array(ev.data);
        if (rupp) rupp.learn(data);
        enqueue(data);
      };

      sock.onerror = (e) => {
        stats.errors++;
        console.warn(`[ring] WS connection error to ${wsUrl}:`, e);
        if (!settled) {
          settled = true;
          reject(new Error(`WebSocket UDP relay failed to connect (${host}:${port})`));
        }
      };

      sock.onclose = (ev) => {
        if (ws === sock) {
          running = false;
          ws = null;
          log(`WS-UDP socket closed (code=${ev.code}, reason=${ev.reason || "none"})`);
        }
      };
    });

    let lastErr = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await connectWs();
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`[ring] WS connect attempt ${attempt}/5 failed: ${err.message}. Retrying...`);
        if (attempt < 5) await new Promise((r) => setTimeout(r, 250 * attempt));
      }
    }
    if (lastErr) throw lastErr;

    return snapshot();
  }

  function snapshot() {
    return { running, tx: stats.tx, rx: stats.rx, txBytes: stats.txBytes, rxBytes: stats.rxBytes, localPort: stats.localPort };
  }

  // ------------------------------------------------------------- tx pump -----
  let pumpDelay = 2;
  let pumping = false;

  function pumpLoop() {
    if (!pumping) {
      pumping = true;
      (running ? pumpOut() : Promise.resolve(0))
        .catch((e) => {
          stats.errors++;
          log("tx: " + e);
          return 0;
        })
        .then((sent) => {
          pumping = false;
          pumpDelay = sent ? 1 : Math.min(8, pumpDelay + 1);
          setTimeout(pumpLoop, pumpDelay);
        });
      return;
    }
    setTimeout(pumpLoop, pumpDelay);
  }

  async function pumpOut() {
    if (!i32) return 0;
    let tail = Atomics.load(i32, TX_TAIL >> 2);
    const head = Atomics.load(i32, TX_HEAD >> 2);
    let sent = 0;
    while (tail !== head) {
      const base = TX0 + (tail & (NSLOT - 1)) * SLOT;
      const len = u32[base >> 2];
      if (len === 0 || len > MAX_DATAGRAM) break;
      const dgram = u8.slice(base + 4, base + 4 + len);
      if (rupp) rupp.stamp(dgram);
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(dgram);
        }
      } else if (writer) {
        await writer.write({ data: dgram });
      }
      stats.tx++;
      stats.txBytes += len;
      sent++;
      tail++;
      Atomics.store(i32, TX_TAIL >> 2, tail);
    }
    return sent;
  }

  // ------------------------------------------------------------- rx path -----
  async function readLoop() {
    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (e) {
        stats.errors++;
        log("rx error: " + e);
        break;
      }
      if (chunk.done) break;
      const msg = chunk.value;
      const data = new Uint8Array(msg.data || msg);
      if (rupp) rupp.learn(data);
      enqueue(data);
    }
    running = false;
    log("socket closed");
  }

  function enqueue(data) {
    if (!data.length || !i32) return;
    const len = Math.min(data.length, MAX_DATAGRAM);
    const head = Atomics.load(i32, RX_HEAD >> 2);
    const tail = Atomics.load(i32, RX_TAIL >> 2);
    if (head - tail >= NSLOT) {
      stats.dropRx++;
      return;
    }
    const base = RX0 + (head & (NSLOT - 1)) * SLOT;
    u8.set(data.subarray(0, len), base + 4);
    u32[base >> 2] = len;
    Atomics.store(i32, RX_HEAD >> 2, head + 1);
    Atomics.notify(i32, WAKE >> 2, 1); // wake the engine's recv thread
    stats.rx++;
    stats.rxBytes += len;
  }

  globalThis.__rkRing = Object.assign(
    () => snapshot(),
    { start, stats, get rupp() { return rupp; }, get running() { return running; } }
  );
  log("ring seam installed");
})();
