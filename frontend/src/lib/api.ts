// Simple API helper for frontend integration
// Refactored to use centralized config + resilient WebSocket with optional reconnect.

import { API_BASE, WS_BASE, WS_PATH_CONVERSATION, WS_PATH_INBOX, defaultReconnect, ReconnectOptions, ENABLE_WS, VAPID_PUBLIC_KEY } from './config';

export type Tokens = { access: string; refresh: string };

class APIClient {
  baseUrl: string;
  access: string | null = null;
  refresh: string | null = null;

  constructor(baseUrl = API_BASE) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    // Attempt restore from localStorage (browser only)
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('auth_tokens_v1');
        if (raw) {
          const parsed = JSON.parse(raw);
          this.access = parsed.access || null;
          this.refresh = parsed.refresh || null;
        }
      } catch {}
    }
  }

  private async postJsonWithFallback<T=any>(path: string, payload: any, headers: Record<string,string> = {}): Promise<{ ok: boolean; status: number; json: any }>{
    const absUrl = `${this.baseUrl}${path}`;
    const doPost = async (url: string) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });
    let res: Response | null = null;
    try {
      res = await doPost(absUrl);
    } catch {
      try { res = await doPost(path); } catch { res = null; }
    }
    if (!res || !('ok' in res)) {
      // final attempt relative if first did not throw but returned undefined (edge)
      try { res = await doPost(path); } catch {}
    }
  if (!res) throw new Error('Network error');
    let data: any = null;
    try { data = await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, json: data };
  }

  async login(identifier: string, password: string, otp?: string) {
    const body: any = { password };
    if (identifier.includes('@')) body.email = identifier; else body.username = identifier;
    if (otp) body.otp = otp;
    const { ok, json, status } = await this.postJsonWithFallback('/api/auth/token/', body);
    if (!ok) {
      const err = json || {};
      if (err && err.otp_required) {
        const e: any = new Error(err.detail || 'OTP required');
        e.otp_required = true;
        (e as any).status = status;
        (e as any).data = err;
        throw e;
      }
      let msg = err?.detail as string | undefined;
      if (!msg) {
        if (status === 401) msg = 'بيانات تسجيل الدخول غير صحيحة';
        else if (status === 403) msg = 'تم الرفض (403)';
        else if (status === 404) msg = 'المسار /api/auth/token/ غير موجود (404)';
        else if (status === 429) msg = 'محاولات كثيرة جدًا. الرجاء المحاولة لاحقًا (429)';
        else msg = `فشل تسجيل الدخول (HTTP ${status})`;
      }
      const e: any = new Error(msg);
      e.status = status;
      e.data = err;
      throw e;
    }
    const data = json;
    this.access = data.access;
    this.refresh = data.refresh;
    if (typeof window !== 'undefined') {
      localStorage.setItem('auth_tokens_v1', JSON.stringify({ access: this.access, refresh: this.refresh }));
    }
    return data as Tokens;
  }

  async teamLogin(owner_username: string, team_username: string, password: string) {
    const { ok, json, status } = await this.postJsonWithFallback('/api/auth/team/login', { owner_username, team_username, password });
    if (!ok) {
      const err = json || {};
      let msg = err?.detail as string | undefined;
      if (!msg) {
        if (status === 401) msg = 'بيانات تسجيل الدخول غير صحيحة';
        else if (status === 404) msg = 'مسار تسجيل دخول الفريق غير موجود (404)';
        else if (status === 429) msg = 'محاولات كثيرة جدًا. الرجاء المحاولة لاحقًا (429)';
        else msg = `فشل تسجيل دخول الفريق (HTTP ${status})`;
      }
      const e: any = new Error(msg);
      e.status = status;
      e.data = err;
      throw e;
    }
    const data = json;
    this.access = data.access;
    this.refresh = data.refresh;
    if (typeof window !== 'undefined') {
      localStorage.setItem('auth_tokens_v1', JSON.stringify({ access: this.access, refresh: this.refresh }));
    }
    return data as Tokens;
  }

  async refreshToken() {
    if (!this.refresh) throw new Error('No refresh token');
    const { ok, json } = await this.postJsonWithFallback('/api/auth/token/refresh/', { refresh: this.refresh });
    if (!ok) throw new Error('Refresh failed');
    const data = json;
    this.access = data.access;
    if (typeof window !== 'undefined') {
      localStorage.setItem('auth_tokens_v1', JSON.stringify({ access: this.access, refresh: this.refresh }));
    }
    return data.access as string;
  }

  private async authFetch(path: string, options: RequestInit = {}, retry = true): Promise<Response> {
    if (!this.access) throw new Error('Not authenticated');
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        Authorization: `Bearer ${this.access}`,
      },
    });
    if ((res.status === 401 || res.status === 403) && retry && this.refresh) {
      try {
        await this.refreshToken();
        return this.authFetch(path, options, false);
      } catch {}
    }
    return res;
  }

  getCurrencies(): Promise<any[]> {
    return this.authFetch('/api/currencies/')
      .then((r: Response) => r.json())
      .then(d => {
        if (Array.isArray(d)) return d; // non-paginated
        if (d && Array.isArray(d.results)) return d.results; // paginated structure
        return [];
      });
  }

  bootstrapCurrencies(): Promise<any> {
    return this.authFetch('/api/currencies/bootstrap/', { method: 'POST' })
      .then((r: Response) => r.json());
  }

  listConversations(): Promise<any[]> {
    return this.authFetch('/api/conversations/')
      .then((r: Response) => r.json())
      .then(data => {
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.results)) return data.results;
        return [];
      });
  }

  getConversation(id: number): Promise<any> {
    return this.authFetch(`/api/conversations/${id}/`).then((r: Response) => r.json());
  }

  getMe(): Promise<any> {
    return this.authFetch('/api/auth/me/').then((r: Response) => r.json());
  }

  getMessages(id: number, limit = 50, offset = 0): Promise<any> {
    // backend currently exposes messages via /api/conversations/{id}/messages/
    return this.authFetch(`/api/conversations/${id}/messages/?limit=${limit}&offset=${offset}`)
      .then((r: Response) => r.json())
      .then(data => {
        if (Array.isArray(data)) return data;
        if (data && Array.isArray((data as any).results)) return (data as any).results;
        return [];
      });
  }

  // Optional alternative pagination: before cursor
  getMessagesBefore(id: number, limit = 50, before?: number): Promise<any> {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (typeof before === 'number') params.set('before', String(before));
    return this.authFetch(`/api/conversations/${id}/messages/?${params.toString()}`)
      .then((r: Response) => r.json())
      .then(data => {
        if (Array.isArray(data)) return data;
        if (data && Array.isArray((data as any).results)) return (data as any).results;
        return [];
      });
  }

  clearConversation(id: number): Promise<{status:string; deleted_messages:number}> {
    return this.authFetch(`/api/conversations/${id}/clear/`, { method: 'POST' }).then((r: Response) => r.json());
  }

  deleteConversation(id: number): Promise<any> {
    return this.authFetch(`/api/conversations/${id}/`, { method: 'DELETE' }).then(async (r: Response) => {
      if (!r.ok && r.status !== 204) {
        const data = await r.json().catch(()=>({}));
        const msg = data?.detail || 'Delete failed';
        throw new Error(msg);
      }
      return { ok: true };
    });
  }

  async requestDeleteConversation(id: number, otp?: string): Promise<any> {
    const headers: any = otp ? { 'X-OTP-Code': otp } : {};
    const res = await this.authFetch(`/api/conversations/${id}/request_delete/`, { method: 'POST', headers });
    const data = await res.json().catch(()=>({}));
    if (res.status === 403 && data && data.otp_required) {
      const e: any = new Error(data.detail || 'OTP required');
      e.otp_required = true;
      throw e;
    }
    if (!res.ok) {
      const msg = data?.detail || 'Failed';
      throw new Error(msg);
    }
    return data;
  }

  approveDeleteConversation(id: number): Promise<any> {
    return this.authFetch(`/api/conversations/${id}/approve_delete/`, { method: 'POST' }).then((r: Response) => r.json());
  }

  declineDeleteConversation(id: number): Promise<any> {
    return this.authFetch(`/api/conversations/${id}/decline_delete/`, { method: 'POST' }).then((r: Response) => r.json());
  }

  // Mute / Unmute conversation
  muteConversation(id: number): Promise<{ mutedUntil: string|null }> {
    return this.authFetch(`/api/conversations/${id}/mute/`, { method: 'POST' }).then((r: Response) => r.json());
  }
  unmuteConversation(id: number): Promise<{ mutedUntil: string|null }> {
    return this.authFetch(`/api/conversations/${id}/mute/`, { method: 'DELETE' }).then((r: Response) => r.json());
  }

  // Differential fetch: get messages with id > sinceId (ascending)
  getMessagesSince(id: number, sinceId: number, limit = 200): Promise<any> {
    const params = new URLSearchParams();
    if (sinceId && sinceId > 0) params.set('since_id', String(sinceId));
    params.set('limit', String(limit));
    return this.authFetch(`/api/conversations/${id}/messages/?${params.toString()}`)
      .then((r: Response) => r.json())
      .then(data => {
        if (Array.isArray(data)) return data;
        if (data && Array.isArray((data as any).results)) return (data as any).results;
        return [];
      });
  }

  createConversation(other_user_id: number): Promise<any> {
    return this.authFetch('/api/conversations/', {
      method: 'POST',
      body: JSON.stringify({ other_user_id })
    }).then(async (r: Response) => {
      const data = await r.json().catch(()=>({}));
      if (!r.ok) {
        const msg = data?.detail || 'تعذر إنشاء المحادثة';
        const err: any = new Error(msg);
        err.status = r.status;
        err.response = data;
        throw err;
      }
      return data;
    });
  }

  createConversationByUsername(other_user_username: string): Promise<any> {
    return this.authFetch('/api/conversations/', {
      method: 'POST',
      body: JSON.stringify({ other_user_username })
    }).then(async (r: Response) => {
      const data = await r.json().catch(()=>({}));
      if (!r.ok) {
        const msg = data?.detail || 'تعذر إنشاء المحادثة';
        const err: any = new Error(msg);
        err.status = r.status;
        err.response = data;
        throw err;
      }
      return data;
    });
  }

  async sendMessage(conversationId: number, body: string, otp?: string): Promise<any> {
    const headers: any = otp ? { 'X-OTP-Code': otp } : {};
    const res = await this.authFetch(`/api/conversations/${conversationId}/send/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body })
    });
    const data = await res.json().catch(()=>({}));
    if (res.status === 403 && data && data.otp_required) {
      const e: any = new Error(data.detail || 'OTP required');
      e.otp_required = true;
      throw e;
    }
    if (!res.ok) {
      const msg = data?.detail || 'Failed';
      const err: any = new Error(msg);
      err.status = res.status;
      err.response = data;
      throw err;
    }
    return data;
  }

  async uploadConversationAttachment(conversationId: number, file: File, caption?: string, otp?: string): Promise<any> {
    if (!this.access) throw new Error('Not authenticated');
    const form = new FormData();
    form.append('file', file);
    if (caption) form.append('body', caption);
    const headers: any = { Authorization: `Bearer ${this.access}` };
    if (otp) headers['X-OTP-Code'] = otp;
    const res = await fetch(`${this.baseUrl}/api/conversations/${conversationId}/send_attachment/`, {
      method: 'POST',
      headers,
      body: form,
    });
    const data = await res.json().catch(()=>({}));
    if (res.status === 403 && data && data.otp_required) {
      const e: any = new Error(data.detail || 'OTP required');
      e.otp_required = true;
      throw e;
    }
    if (!res.ok) {
      const msg = data?.detail || 'Upload failed';
      const err: any = new Error(msg);
      err.status = res.status;
      err.response = data;
      throw err;
    }
    return data;
  }

  createTransaction(conversation: number, currency_id: number, amount: string, direction: 'lna'|'lkm', note?: string): Promise<any> {
    return this.authFetch('/api/transactions/', {
      method: 'POST',
      body: JSON.stringify({ conversation, currency_id, amount, direction, note })
    }).then(async (r: Response) => {
      const data = await r.json().catch(()=>({}));
      if (!r.ok) {
        const msg = (data && (data.detail || data.error)) ? (data.detail || data.error) : 'Transaction failed';
        const err: any = new Error(msg);
        err.status = r.status;
        err.response = data;
        throw err;
      }
      return data;
    });
  }

  getWallets(): Promise<any> {
    return this.authFetch('/api/wallets/')
      .then((r: Response) => r.json())
      .then(d => {
        if (Array.isArray(d)) return d;
        if (d && Array.isArray(d.results)) return d.results;
        return [];
      });
  }

  getSummary(conversationId: number): Promise<any> {
    return this.authFetch(`/api/conversations/${conversationId}/summary/`).then((r: Response) => r.json());
  }

  getNetBalance(conversationId: number): Promise<any> {
    return this.authFetch(`/api/conversations/${conversationId}/net_balance/`).then((r: Response) => r.json());
  }

  // Mark conversation as read (if backend supports it)
  async readConversation(conversationId: number): Promise<any> {
    const res = await this.authFetch(`/api/conversations/${conversationId}/read/`, { method: 'POST' });
    if (!res.ok) return {};
    return res.json().catch(()=>({}));
  }

  getProfile(): Promise<any> {
    return this.authFetch('/api/auth/me/').then((r: Response) => r.json());
  }

  ensureAdminConversation(): Promise<{ created: boolean; conversation_id?: number }> {
    return this.authFetch('/api/ensure_admin_conversation', { method: 'POST' }).then(async (r: Response) => {
      const data = await r.json().catch(()=>({}));
      if (!r.ok) {
        const msg = data?.detail || 'تعذر إنشاء محادثة مع الأدمن';
        const err: any = new Error(msg);
        err.status = r.status;
        err.response = data;
        throw err;
      }
      return data;
    });
  }

  updateProfile(patch: { first_name?: string; last_name?: string; phone?: string }): Promise<any> {
    return this.authFetch('/api/auth/me/', {
      method: 'PATCH',
      body: JSON.stringify(patch)
    }).then((r: Response) => r.json());
  }

  changePassword(old_password: string, new_password: string): Promise<any> {
    return this.authFetch('/api/auth/me/?action=change_password', {
      method: 'POST',
      body: JSON.stringify({ old_password, new_password })
    }).then((r: Response) => r.json());
  }

  // TOTP endpoints
  getTotpStatus(): Promise<{ enabled: boolean; has_secret: boolean }> {
    return this.authFetch('/api/auth/totp/status').then(async (r: Response) => {
      const data = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(data?.detail || 'فشل تحميل الحالة');
      return data;
    });
  }
  setupTotp(): Promise<{ secret: string; otpauth_uri: string }> {
    return this.authFetch('/api/auth/totp/setup', { method: 'POST' }).then(async (r: Response) => {
      const data = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(data?.detail || 'تعذر إنشاء المفتاح');
      return data;
    });
  }
  enableTotp(otp: string): Promise<{ enabled: boolean }> {
    return this.authFetch('/api/auth/totp/enable', { method: 'POST', body: JSON.stringify({ otp }) }).then(async (r: Response) => {
      const data = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(data?.detail || 'تعذر التفعيل');
      return data;
    });
  }
  disableTotp(otp: string): Promise<{ enabled: boolean }> {
    return this.authFetch('/api/auth/totp/disable', { method: 'POST', body: JSON.stringify({ otp }) }).then(async (r: Response) => {
      const data = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(data?.detail || 'تعذر الإلغاء');
      return data;
    });
  }

  async uploadProfilePhoto(file: File): Promise<any> {
    if (!this.access) throw new Error('Not authenticated');
    const form = new FormData();
    form.append('action', 'upload_logo');
    form.append('logo', file);
    const res = await fetch(`${this.baseUrl}/api/auth/me/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.access}`,
      },
      body: form
    });
    const data = await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(data?.detail || 'Upload failed');
    return data;
  }

  searchUsers(query: string, excludeSelf = true): Promise<any[]> {
    const q = encodeURIComponent(query);
    return this.authFetch(`/api/users/?q=${q}${excludeSelf ? '&exclude_self=1' : ''}`)
      .then((r: Response) => r.json())
      .then(data => {
        if (data && Array.isArray(data)) return data; // non-paginated
        if (data && Array.isArray(data.results)) return data.results; // paginated structure
        return [];
      });
  }

  private _buildWsUrl(path: string) {
    const sep = path.startsWith('/') ? '' : '/';
    const base = `${WS_BASE}${sep}${path}`;
    return this.access ? `${base}?token=${encodeURIComponent(this.access)}` : base;
  }

  connectSocket(conversationId: number) {
    if (!ENABLE_WS) throw new Error('WebSocket disabled by configuration');
    const url = this._buildWsUrl(WS_PATH_CONVERSATION(conversationId));
    const ws = new WebSocket(url);
    return ws;
  }

  connectSocketWithRetry(conversationId: number, opts: ReconnectOptions = {}) {
    if (!ENABLE_WS) {
      return {
        socket: null,
        close() {},
        on() { return this; }
      } as any;
    }
    const cfg = { ...defaultReconnect, ...opts };
    let attempt = 0;
    let closedByUser = false;
  let ws: WebSocket | null = null;
  const buildUrl = () => this._buildWsUrl(WS_PATH_CONVERSATION(conversationId));
  const listeners: { open?: () => void; message?: (ev: MessageEvent) => void; close?: (ev: CloseEvent) => void; error?: (ev: Event) => void } = {};

    const backoff = () => {
      const d = Math.min(cfg.initialDelayMs * Math.pow(cfg.factor, attempt - 1), cfg.maxDelayMs);
      return d;
    };

    const spawn = async () => {
      if (closedByUser) return;
      attempt += 1;
      // ensure we have a fresh access token if possible
      if (!this.access && this.refresh) {
        try { await this.refreshToken(); } catch {}
      }
      ws = new WebSocket(buildUrl());
      ws.onopen = () => { attempt = 1; listeners.open && listeners.open(); };
      ws.onmessage = (e) => listeners.message && listeners.message(e);
      ws.onerror = (e) => { listeners.error && listeners.error(e); };
      ws.onclose = (e) => {
        listeners.close && listeners.close(e);
        if (!closedByUser && attempt < cfg.maxAttempts && e.code !== 1000) {
          const doRetry = async () => {
            // If unauthorized/forbidden custom close code, try to refresh token before retry
            if ((e.code === 4001 || e.code === 1008) && this.refresh) {
              try { await this.refreshToken(); } catch {}
            }
            const delay = backoff();
            setTimeout(() => { spawn(); }, delay);
          };
          doRetry();
        }
      };
    };
    spawn();
    return {
      get socket() { return ws; },
      close() { closedByUser = true; if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) { try { ws.close(); } catch {} } },
      on(event: 'open'|'message'|'close'|'error', cb: any) { (listeners as any)[event] = cb; return this; }
    };
  }

  connectInboxWithRetry(opts: ReconnectOptions = {}) {
    if (!ENABLE_WS) {
      return { socket: null, close() {}, on() { return this; } } as any;
    }
    const cfg = { ...defaultReconnect, ...opts };
    let attempt = 0;
    let closedByUser = false;
    let ws: WebSocket | null = null;
    const buildUrl = () => this._buildWsUrl(WS_PATH_INBOX);
    const listeners: { open?: () => void; message?: (ev: MessageEvent) => void; close?: (ev: CloseEvent) => void; error?: (ev: Event) => void } = {};
    const backoff = () => Math.min(cfg.initialDelayMs * Math.pow(cfg.factor, Math.max(0, attempt - 1)), cfg.maxDelayMs);
    const spawn = async () => {
      if (closedByUser) return;
      attempt += 1;
      // Ensure access token present/updated if possible before connecting
      if (!this.access && this.refresh) {
        try { await this.refreshToken(); } catch {}
      }
      ws = new WebSocket(buildUrl());
      ws.onopen = () => { attempt = 1; listeners.open && listeners.open(); };
      ws.onmessage = (e) => listeners.message && listeners.message(e);
      ws.onerror = (e) => listeners.error && listeners.error(e);
      ws.onclose = (e) => {
        listeners.close && listeners.close(e);
        if (!closedByUser && attempt < cfg.maxAttempts && e.code !== 1000) {
          const doRetry = async () => {
            // If server indicates auth issue, try to refresh token before retrying
            if ((e.code === 4001 || e.code === 1008) && this.refresh) {
              try { await this.refreshToken(); } catch {}
            }
            setTimeout(() => { spawn(); }, backoff());
          };
          doRetry();
        }
      };
    };
    spawn();
    return {
      get socket() { return ws; },
      close() { closedByUser = true; if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) { try { ws.close(); } catch {} } },
      on(event: 'open'|'message'|'close'|'error', cb: any) { (listeners as any)[event] = cb; return this; }
    };
  }

  // Push subscription backend calls
  async pushSubscribe(payload: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string }): Promise<any> {
    return this.authFetch('/api/push/subscribe', { method: 'POST', body: JSON.stringify(payload) }).then((r: Response) => r.json());
  }
  async pushUnsubscribe(endpoint: string): Promise<any> {
    return this.authFetch('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }).then((r: Response) => r.json());
  }

  // Browser only helpers to register SW and subscribe
  async registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (typeof window === 'undefined') return null;
    if (!('serviceWorker' in navigator)) return null;
    try {
      // Use versioned URL to force updates when SW_VERSION changes
      const { SW_VERSION } = await import('./config');
      const suffix = SW_VERSION ? `?v=${encodeURIComponent(SW_VERSION)}` : '';
      const reg = await navigator.serviceWorker.register(`/sw.js${suffix}`);
      return reg;
    } catch (e) { return null; }
  }

  // Fetch notification sound URL managed by admin (if any)
  async getNotificationSoundUrl(): Promise<string|null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/notification/sound`);
      if (!res.ok) return null;
      const data = await res.json().catch(()=>({}));
      const url = (data && typeof data.sound_url === 'string' && data.sound_url) ? data.sound_url : null;
      return url;
    } catch { return null; }
  }

  async ensurePushPermission(): Promise<NotificationPermission> {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    return await Notification.requestPermission();
  }

  urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async createPushSubscription(): Promise<PushSubscription | null> {
    if (typeof window === 'undefined') return null;
    const perm = await this.ensurePushPermission();
    if (perm !== 'granted') return null;
    const reg = await this.registerServiceWorker();
    if (!reg) return null;
    const existing = await reg.pushManager.getSubscription();
    if (existing) return existing;
    if (!VAPID_PUBLIC_KEY) throw new Error('Missing VAPID public key');
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: this.urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    return sub;
  }

  async enablePush(): Promise<boolean> {
    const sub = await this.createPushSubscription();
    if (!sub) return false;
    const info = sub.toJSON() as any;
    await this.pushSubscribe({ endpoint: info.endpoint, keys: info.keys, userAgent: navigator.userAgent });
    return true;
  }

  async disablePush(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const reg = await this.registerServiceWorker();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return true;
    const info = sub.toJSON() as any;
    try { await this.pushUnsubscribe(info.endpoint); } catch {}
    try { await sub.unsubscribe(); } catch {}
    return true;
  }

  // Subscriptions API
  async getMySubscription(): Promise<{ subscription: any|null; pending_request: any|null }> {
    const res = await this.authFetch('/api/subscriptions/me');
    const data = await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(data?.detail || 'فشل تحميل الاشتراك');
    return data;
  }

  async getSubscriptionPlans(): Promise<any[]> {
    const res = await this.authFetch('/api/subscriptions/plans');
    if (res.ok) {
      const data = await res.json().catch(()=>([]));
      if (Array.isArray(data)) return data;
      return [];
    }
    // Fallback to fixed codes if endpoint not available
    return [
      { code: 'silver', name: 'Silver' },
      { code: 'golden', name: 'Golden' },
      { code: 'king', name: 'King' },
    ];
  }

  async renewSubscription(plan_code: 'silver'|'golden'|'king', period: 'monthly'|'yearly'): Promise<any> {
    const res = await this.authFetch('/api/subscriptions/renew', {
      method: 'POST',
      body: JSON.stringify({ plan_code, period })
    });
    const data = await res.json().catch(()=>({}));
    if (!res.ok) {
      const msg = data?.detail || 'تعذر إنشاء طلب التجديد';
      const err: any = new Error(msg);
      err.response = data;
      throw err;
    }
    return data;
  }
}

export const apiClient = new APIClient();
