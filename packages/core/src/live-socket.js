// SPDX-License-Identifier: MIT
// FileEngine embedding kit — LiveSocket (§4.1 live channels). (c) 2026 James Hickman.
//
// The WebSocket companion for the kit's live channels (discussion-live, RAG chat). A
// thin wrapper over a WebSocket: JSON message framing, listener fan-out, and automatic
// reconnect with exponential backoff. The WebSocket constructor and the reconnect
// scheduler are injectable, so the whole thing is unit-testable without a browser.

export class LiveSocket {
  #url;
  #WS;
  #schedule;
  #reconnect;
  #maxDelay;
  #ws = null;
  #closed = false;
  #retries = 0;
  #onMsg = [];
  #onOpen = [];
  #onClose = [];

  /**
   * @param {string} url  ws:// or wss:// URL
   * @param {{WebSocketImpl?: any, schedule?: Function, reconnect?: boolean, maxDelay?: number}} [opts]
   */
  constructor(url, opts = {}) {
    this.#url = url;
    this.#WS = opts.WebSocketImpl || (typeof WebSocket !== "undefined" ? WebSocket : undefined);
    this.#schedule = opts.schedule ||
      ((fn, ms) => (typeof setTimeout !== "undefined" ? setTimeout(fn, ms) : null));
    this.#reconnect = opts.reconnect !== false;
    this.#maxDelay = opts.maxDelay || 30000;
  }

  onMessage(fn) { this.#onMsg.push(fn); return () => { this.#onMsg = this.#onMsg.filter((f) => f !== fn); }; }
  onOpen(fn) { this.#onOpen.push(fn); return () => { this.#onOpen = this.#onOpen.filter((f) => f !== fn); }; }
  onClose(fn) { this.#onClose.push(fn); return () => { this.#onClose = this.#onClose.filter((f) => f !== fn); }; }

  get connected() { return !!this.#ws && this.#ws.readyState === 1; }

  connect() {
    if (!this.#WS) return this;
    const ws = new this.#WS(this.#url);
    this.#ws = ws;
    ws.onopen = () => { this.#retries = 0; for (const f of this.#onOpen.slice()) f(); };
    ws.onmessage = (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch { data = ev.data; }
      for (const f of this.#onMsg.slice()) f(data);
    };
    ws.onclose = () => {
      for (const f of this.#onClose.slice()) f();
      if (this.#reconnect && !this.#closed) {
        const delay = Math.min(this.#maxDelay, 500 * Math.pow(2, this.#retries++));
        this.#schedule(() => { if (!this.#closed) this.connect(); }, delay);
      }
    };
    ws.onerror = () => {};
    return this;
  }

  /** Send a message (objects are JSON-encoded). No-op unless the socket is open. */
  send(message) {
    if (this.connected) this.#ws.send(typeof message === "string" ? message : JSON.stringify(message));
  }

  /** Intentional close — suppresses reconnect. */
  close() {
    this.#closed = true;
    if (this.#ws) this.#ws.close();
  }
}
