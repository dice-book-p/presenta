const SESSION_KEY = 'presenta_sign_session';

class SessionStore {
  data = $state(null); // { signId, title, name, order }

  constructor() {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) {
        try { this.data = JSON.parse(saved); } catch {}
      }
    }
  }

  save(signatory) {
    this.data = signatory;
    localStorage.setItem(SESSION_KEY, JSON.stringify(signatory));
  }

  clear() {
    this.data = null;
    localStorage.removeItem(SESSION_KEY);
  }

  get hasSession() {
    return this.data !== null;
  }
}

export const session = new SessionStore();
