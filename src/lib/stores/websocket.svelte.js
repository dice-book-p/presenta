import { WS_URL } from '$lib/config.js';

const PING_INTERVAL = 15_000;   // 15초마다 ping
const PONG_TIMEOUT  = 5_000;    // 5초 내 pong 없으면 끊김 간주
const MAX_RECONNECT_DELAY = 30_000;

class WebSocketStore {
  ws = $state(null);
  status = $state('disconnected'); // disconnected | connecting | connected | rejected | force_disconnected
  rejectReason = $state(null);

  /** @type {Map<string, Function[]>} */
  #handlers = new Map();
  #reconnectTimer = null;
  #manualClose = false;
  #currentWs = null;
  #reconnectAttempts = 0;
  #pingTimer = null;
  #pongTimeout = null;

  connect() {
    const rs = this.#currentWs?.readyState;
    if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) return;

    this.status = 'connecting';
    this.#manualClose = false;

    const ws = new WebSocket(WS_URL);
    this.#currentWs = ws;

    ws.onopen = () => {
      this.status = 'connected';
      this.ws = ws;
      this.#reconnectAttempts = 0;
      clearTimeout(this.#reconnectTimer);
      this.#startPing();
      // 재연결 시 핸들러에게 알림
      this.#dispatch('_reconnected', {});
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'pong') {
          clearTimeout(this.#pongTimeout);
          return;
        }

        if (msg.type === 'force_disconnect') {
          this.status = 'force_disconnected';
          this.#manualClose = true;
          this.#dispatch('force_disconnect', msg);
          ws.close();
          return;
        }

        this.#dispatch(msg.type, msg);
        this.#dispatch('*', msg);
      } catch {}
    };

    ws.onclose = () => {
      if (this.#currentWs !== ws && this.ws !== ws) return;
      if (this.#currentWs === ws) this.#currentWs = null;
      if (this.ws === ws) this.ws = null;

      this.#stopPing();

      if (this.#manualClose) return;
      if (this.status !== 'rejected') {
        this.status = 'disconnected';
        // 지수 백오프 재연결 (1s → 2s → 4s → ... → 30s)
        const delay = Math.min(
          1000 * Math.pow(2, this.#reconnectAttempts),
          MAX_RECONNECT_DELAY
        );
        this.#reconnectAttempts++;
        this.#reconnectTimer = setTimeout(() => this.connect(), delay);
      }
    };

    ws.onerror = () => {};
  }

  disconnect() {
    this.#manualClose = true;
    clearTimeout(this.#reconnectTimer);
    this.#stopPing();
    this.#currentWs?.close();
    this.#currentWs = null;
    this.ws = null;
    this.status = 'disconnected';
    this.#reconnectAttempts = 0;
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  #dispatch(type, msg) {
    const list = this.#handlers.get(type);
    if (list) list.forEach(fn => fn(msg));
  }

  #startPing() {
    this.#stopPing();
    this.#pingTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ type: 'ping' }));
      this.#pongTimeout = setTimeout(() => {
        this.ws?.close(); // pong 미응답 → 끊김 간주
      }, PONG_TIMEOUT);
    }, PING_INTERVAL);
  }

  #stopPing() {
    clearInterval(this.#pingTimer);
    clearTimeout(this.#pongTimeout);
  }

  /** @returns {() => void} unsubscribe */
  on(type, handler) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, []);
    this.#handlers.get(type).push(handler);
    return () => {
      const list = this.#handlers.get(type);
      if (!list) return;
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
      if (list.length === 0) this.#handlers.delete(type);
    };
  }

  off(type) {
    this.#handlers.delete(type);
  }
}

export const wsStore = new WebSocketStore();
