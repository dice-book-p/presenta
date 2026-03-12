import { WS_URL } from '$lib/config.js';

class WebSocketStore {
  ws = $state(null);
  status = $state('disconnected'); // disconnected | connecting | connected | rejected | force_disconnected
  rejectReason = $state(null);

  #handlers = new Map();
  #reconnectTimer = null;
  #manualClose = false;

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.status = 'connecting';
    this.#manualClose = false;

    const ws = new WebSocket(WS_URL);

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
      this.ws = null;
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
    this.ws?.close();
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
