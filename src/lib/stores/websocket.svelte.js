import { WS_URL } from '$lib/config.js';

class WebSocketStore {
  ws = $state(null);
  status = $state('disconnected'); // disconnected | connecting | connected | rejected | force_disconnected
  rejectReason = $state(null);

  #handlers = new Map();
  #reconnectTimer = null;
  #manualClose = false;
  #currentWs = null; // tracks WS in CONNECTING state too (not reactive)

  connect() {
    // Don't create another WS if already open or connecting
    const rs = this.#currentWs?.readyState;
    if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) return;

    this.status = 'connecting';
    this.#manualClose = false;

    const ws = new WebSocket(WS_URL);
    this.#currentWs = ws;

    ws.onopen = () => {
      this.status = 'connected';
      this.ws = ws;
      clearTimeout(this.#reconnectTimer);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'force_disconnect') {
          this.status = 'force_disconnected';
          this.#manualClose = true;
          const fdHandler = this.#handlers.get('force_disconnect');
          if (fdHandler) fdHandler(msg);
          ws.close();
          return;
        }
        const handler = this.#handlers.get(msg.type);
        if (handler) handler(msg);
        const allHandler = this.#handlers.get('*');
        if (allHandler) allHandler(msg);
      } catch {}
    };

    ws.onclose = () => {
      // Ignore stale close events from replaced connections
      if (this.#currentWs !== ws && this.ws !== ws) return;

      if (this.#currentWs === ws) this.#currentWs = null;
      if (this.ws === ws) this.ws = null;

      if (this.#manualClose) return;
      if (this.status !== 'rejected') {
        this.status = 'disconnected';
        // 3초 후 자동 재연결
        this.#reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    };

    ws.onerror = () => {
      this.status = 'disconnected';
    };
  }

  disconnect() {
    this.#manualClose = true;
    clearTimeout(this.#reconnectTimer);
    // Close both connecting and open WS
    this.#currentWs?.close();
    this.#currentWs = null;
    this.ws = null;
    this.status = 'disconnected';
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  on(type, handler) {
    this.#handlers.set(type, handler);
    return () => this.#handlers.delete(type);
  }

  off(type) {
    this.#handlers.delete(type);
  }
}

export const wsStore = new WebSocketStore();
