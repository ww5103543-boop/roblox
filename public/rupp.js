// rupp.js — the three TLV fields the join script owns.
//
// The engine's RakNet emits correct RUPP framing, but three fields are session
// data only the join script knows:
//
//   TLV1 subtype 1   NetStackTokenValue            (handshake)
//   TLV1 subtype 2   the token the server sends in Reply2
//   TLV2             RCC address + NetStackPort while handshaking,
//                    RCC address + ServerConnections[0].Port after that
//
// The engine fills them with its own random values and the edge silently drops
// anything that disagrees. Port of app/rkhost/src/rupp.rs.
(() => {
  const TLV1 = 1;
  const TLV2 = 2;
  const TOKEN_TLV_LEN = 17; // subtype byte + 16 token bytes
  const ADDR_TLV_LEN = 6; // 4 address bytes + 2 port bytes

  /** Length of the TLV block a datagram declares, bounded by the datagram. */
  function tlv_end(d) {
    if (d.length < 8 || d[0] !== 0x01 || d[1] !== 0x00) return -1;
    const total = (d[2] << 8) | d[3];
    if (total < 4 || total > d.length) return -1;
    return total;
  }

  function b64_16(text) {
    let bin;
    try {
      bin = atob(text);
    } catch (e) {
      return null;
    }
    if (bin.length !== 16) return null;
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function hex16(text) {
    if (!text || text.length !== 32 || !/^[0-9a-fA-F]{32}$/.test(text)) return null;
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function ipv4(text) {
    if (!text) return null;
    const parts = text.split(".");
    if (parts.length !== 4) return null;
    const out = new Uint8Array(4);
    for (let i = 0; i < 4; i++) {
      const n = Number(parts[i]);
      if (!Number.isInteger(n) || n < 0 || n > 255) return null;
      out[i] = n;
    }
    return out;
  }

  class Rupp {
    constructor() {
      this.join = null; // Uint8Array(16)
      this.session = null; // Uint8Array(16)
      this.rcc = null; // { addr: Uint8Array(4), netstack: number }
      this.dataPort = 0;
    }

    /** Take the values a join script names. Safe to call repeatedly. */
    setJoinScript(script) {
      if (!script) return this;
      if (!this.join) {
        const tok = script.NetStackTokenValue || script.TokenValue;
        // The web session hands it over as 32 hex chars; the native-shaped one
        // as base64 of the same 16 bytes.
        this.join = (tok && (tok.length === 32 ? hex16(tok) : b64_16(tok))) || null;
      }
      if (!this.rcc) {
        const conn = (script.ServerConnections || [])[0];
        const addr = ipv4(script.MachineAddress || (conn && conn.Address));
        const netstack = script.NetStackPort;
        if (addr && netstack) this.rcc = { addr, netstack };
      }
      if (!this.dataPort) {
        const conn = (script.ServerConnections || [])[0];
        this.dataPort = (conn && conn.Port) || script.ServerPort || 0;
      }
      return this;
    }

    get ready() {
      return !!(this.join || this.rcc);
    }

    /** Rewrite the fields this session owns, in place. */
    stamp(bytes) {
      if (!this.join && !this.rcc) return bytes;
      const end = tlv_end(bytes);
      if (end < 0) return bytes;
      let p = 4;
      let sub = 0;
      while (p + 2 <= end) {
        const kind = bytes[p];
        const len = bytes[p + 1];
        if (p + 2 + len > end) break;
        if (kind === TLV1 && len === TOKEN_TLV_LEN) {
          sub = bytes[p + 2];
          if (sub === 1 && this.join) {
            bytes.set(this.join, p + 3);
          } else if (sub === 2 && this.session) {
            bytes.set(this.session, p + 3);
          }
        } else if (kind === TLV2 && len === ADDR_TLV_LEN && this.rcc) {
          // Subtype-dependent: the edge validates NetStackPort on the
          // handshake, and the established session is routed by the port it
          // really sends to. Advertising NetStackPort after the handshake
          // black-holes every datagram.
          const port = sub === 2 && this.dataPort ? this.dataPort : this.rcc.netstack;
          bytes.set(this.rcc.addr, p + 2);
          bytes[p + 6] = port >> 8;
          bytes[p + 7] = port & 0xff;
        }
        p += 2 + len;
      }
      return bytes;
    }

    /** Remember the session token the server issues in Reply2. */
    learn(bytes) {
      const end = tlv_end(bytes);
      if (end < 0) return;
      let p = 4;
      while (p + 2 <= end) {
        const kind = bytes[p];
        const len = bytes[p + 1];
        if (p + 2 + len > end) return;
        if (kind === TLV1 && len === TOKEN_TLV_LEN && bytes[p + 2] === 2) {
          this.session = bytes.slice(p + 3, p + 19);
          return;
        }
        p += 2 + len;
      }
    }
  }

  window.Rupp = Rupp;
})();
