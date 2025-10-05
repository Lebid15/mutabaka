// Simple API helper for frontend integration
// Refactored to use centralized config + resilient WebSocket with optional reconnect.

import { API_BASE, WS_BASE, WS_PATH_CONVERSATION, WS_PATH_INBOX, defaultReconnect, ReconnectOptions, ENABLE_WS, VAPID_PUBLIC_KEY } from './config';

export type Tokens = { access: string; refresh: string };

export type LoginInstructionConfig = {
  id: number | null;
  title: string;
  description: string;
  icon_hint?: string | null;
  display_order?: number | null;
};

export type LoginPageConfig = {
  id: number | null;
  hero_title: string;
  hero_description?: string | null;
  instructions_title?: string | null;
  stay_logged_in_label?: string | null;
  stay_logged_in_hint?: string | null;
  alternate_login_label?: string | null;
  alternate_login_url?: string | null;
  footer_links_label?: string | null;
  footer_note?: string | null;
  footer_secondary_note?: string | null;
  footer_brand_name?: string | null;
  footer_year?: string | null;
  footer_year_override?: string | null;
  login_logo_url?: string | null;
  qr_overlay_logo_url?: string | null;
  instructions: LoginInstructionConfig[];
};

export type LoginQrPayload = {
  payload: string;
  expires_in: number;
  request_id: string | null;
};

export type LoginInstructionPayload = {
  id: number | null;
  title: string;
  description: string;
  icon_hint: string | null;
  display_order: number;
};

export type LoginPagePayload = {
  id: number | null;
  hero_title: string;
  hero_description: string;
  instructions_title: string;
  stay_logged_in_label: string;
  stay_logged_in_hint: string;
  alternate_login_label: string;
  alternate_login_url: string;
  footer_links_label: string;
  footer_note: string;
  footer_secondary_note: string;
  footer_brand_name: string;
  footer_year_override: string;
  login_logo_url: string | null;
  qr_overlay_logo_url: string | null;
  footer_year: string;
  instructions: LoginInstructionPayload[];
};

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

  getMessages(id: number, limit = 50, offset = 0, markRead: boolean = false): Promise<any> {
    // backend currently exposes messages via /api/conversations/{id}/messages/
      return this.authFetch(`/api/conversations/${id}/messages/?limit=${limit}&offset=${offset}${markRead ? '&mark_read=1' : ''}`)
      .then((r: Response) => r.json())
      .then(data => {
        if (Array.isArray(data)) return data;
        if (data && Array.isArray((data as any).results)) return (data as any).results;
        return [];
      });
  }

  // Optional alternative pagination: before cursor
  getMessagesBefore(id: number, limit = 50, before?: number, markRead: boolean = false): Promise<any> {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (typeof before === 'number') params.set('before', String(before));
      return this.authFetch(`/api/conversations/${id}/messages/?${params.toString()}${markRead ? '&mark_read=1' : ''}`)
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
  getMessagesSince(id: number, sinceId: number, limit = 200, markRead: boolean = false): Promise<any> {
    const params = new URLSearchParams();
    if (sinceId && sinceId > 0) params.set('since_id', String(sinceId));
    params.set('limit', String(limit));
      return this.authFetch(`/api/conversations/${id}/messages/?${params.toString()}${markRead ? '&mark_read=1' : ''}`)
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

  async sendMessage(conversationId: number, body: string, otp?: string, clientId?: string): Promise<any> {
    const headers: any = otp ? { 'X-OTP-Code': otp } : {};
    const payload: Record<string, any> = { body };
    if (clientId) payload.client_id = clientId;
    const res = await this.authFetch(`/api/conversations/${conversationId}/send/`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
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

  async uploadConversationAttachment(conversationId: number, file: File, caption?: string, otp?: string, clientId?: string): Promise<any> {
    if (!this.access) throw new Error('Not authenticated');
    const form = new FormData();
    form.append('file', file);
    if (caption) form.append('body', caption);
    if (clientId) form.append('client_id', clientId);
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

  async getTransactions(conversationId: number, opts?: { from?: string; to?: string }): Promise<any> {
    const params = new URLSearchParams();
    params.set('conversation', String(conversationId));
    if (opts?.from) params.set('from_date', opts.from);
    if (opts?.to) params.set('to_date', opts.to);
    params.set('ordering', 'created_at');
    const qs = params.toString();
    const res = await this.authFetch(`/api/transactions/${qs ? `?${qs}` : ''}`);
    const data = await res.json().catch(()=>({}));
    if (!res.ok) {
      const err: any = new Error(data?.detail || 'تعذر جلب المعاملات');
      err.status = res.status;
      err.response = data;
      throw err;
    }
    return data;
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

  updateProfile(patch: { first_name?: string; last_name?: string; phone?: string; display_name?: string }): Promise<any> {
    return this.authFetch('/api/auth/me/', {
      method: 'PATCH',
      body: JSON.stringify(patch)
    }).then((r: Response) => r.json());
  }

  async changePassword(old_password: string, new_password: string): Promise<any> {
    const res = await this.authFetch('/api/auth/me/', {
      method: 'POST',
      body: JSON.stringify({ action: 'change_password', old_password, new_password })
    });
    const data = await res.json().catch(()=>({}));
    if (!res.ok) {
      const msg = (data && (data.detail || data.message)) || 'فشل تغيير كلمة السر';
      const err: any = new Error(msg);
      err.status = res.status;
      err.response = data;
      throw err;
    }
    return data;
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

  // Public configuration endpoints (branding, notification sound)
  async getBranding(): Promise<{ logo_url: string | null }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/branding`);
      if (!res.ok) return { logo_url: null };
      const data = await res.json().catch(()=>({}));
      const logo = (data && typeof data.logo_url === 'string' && data.logo_url) ? data.logo_url : null;
      return { logo_url: logo };
    } catch {
      return { logo_url: null };
    }
  }

  async getLoginPagePayload(): Promise<LoginPagePayload | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/login-page`);
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      if (!data || typeof data !== 'object') return null;
      const normalizeString = (value: any): string => (typeof value === 'string' ? value : '');
      const normalizeMaybeString = (value: any): string | null => {
        if (value === null || value === undefined) return null;
        return typeof value === 'string' ? value : String(value ?? '');
      };
      const instructionsRaw = Array.isArray((data as any).instructions) ? (data as any).instructions : [];
      const instructions: LoginInstructionPayload[] = instructionsRaw
        .map((item: any, idx: number) => {
          const description = normalizeString(item?.description);
          if (!description.trim()) return null;
          const idRaw = item?.id;
          const id = typeof idRaw === 'number' ? idRaw : (Number.isFinite(Number(idRaw)) ? Number(idRaw) : null);
          const icon = normalizeString(item?.icon_hint);
          const title = normalizeString(item?.title);
          const orderRaw = item?.display_order;
          const display_order = Number.isFinite(Number(orderRaw)) ? Number(orderRaw) : idx;
          return {
            id,
            title,
            description,
            icon_hint: icon || null,
            display_order,
          } as LoginInstructionPayload;
        })
  .filter((item: LoginInstructionPayload | null): item is LoginInstructionPayload => Boolean(item));
      instructions.sort((a, b) => a.display_order - b.display_order);
      return {
        id: typeof (data as any).id === 'number' ? (data as any).id : null,
        hero_title: normalizeString((data as any).hero_title),
        hero_description: normalizeString((data as any).hero_description),
        instructions_title: normalizeString((data as any).instructions_title),
        stay_logged_in_label: normalizeString((data as any).stay_logged_in_label),
        stay_logged_in_hint: normalizeString((data as any).stay_logged_in_hint),
        alternate_login_label: normalizeString((data as any).alternate_login_label),
        alternate_login_url: normalizeString((data as any).alternate_login_url),
        footer_links_label: normalizeString((data as any).footer_links_label),
        footer_note: normalizeString((data as any).footer_note),
        footer_secondary_note: normalizeString((data as any).footer_secondary_note),
        footer_brand_name: normalizeString((data as any).footer_brand_name) || 'Mutabaka',
        footer_year_override: normalizeString((data as any).footer_year_override),
        login_logo_url: normalizeMaybeString((data as any).login_logo_url),
        qr_overlay_logo_url: normalizeMaybeString((data as any).qr_overlay_logo_url),
        footer_year: normalizeString((data as any).footer_year) || new Date().getFullYear().toString(),
        instructions,
      };
    } catch {
      return null;
    }
  }

  async getContactLinks(): Promise<Array<{ id: number; icon: string; icon_display: string; label: string; value: string }>> {
    try {
      const res = await fetch(`${this.baseUrl}/api/contact-links`);
      if (!res.ok) return [];
      const data = await res.json().catch(() => []);
      if (!Array.isArray(data)) return [];
      return data
        .map((item, idx) => {
          const icon = typeof item?.icon === 'string' ? item.icon.trim() : '';
          const value = typeof item?.value === 'string' ? item.value.trim() : '';
          if (!icon || !value) return null;
          const label = typeof item?.label === 'string' ? item.label : '';
          const iconDisplay = typeof item?.icon_display === 'string' ? item.icon_display : '';
          const idRaw = item?.id;
          const id = typeof idRaw === 'number' ? idRaw : Number(idRaw);
          return {
            id: Number.isFinite(id) ? Number(id) : idx,
            icon,
            icon_display: iconDisplay,
            label,
            value,
          };
        })
        .filter((item): item is { id: number; icon: string; icon_display: string; label: string; value: string } => Boolean(item));
    } catch {
      return [];
    }
  }

  async getLoginPageConfig(): Promise<LoginPageConfig> {
    const fallback = (): LoginPageConfig => ({
      id: null,
      hero_title: 'طريقة تسجيل الدخول إلى حسابك في موقع مطابقة ويب:',
      hero_description: 'اتبع الخطوات التالية لإتمام الربط عبر رمز QR من تطبيق مطابقة على هاتفك.',
      instructions_title: 'خطوات تسجيل الدخول:',
      stay_logged_in_label: 'ابقَ مسجل الدخول على هذا المتصفح',
      stay_logged_in_hint: 'استخدم هذا الخيار على أجهزتك الشخصية فقط.',
      alternate_login_label: 'تسجيل الدخول برقم الهاتف',
      alternate_login_url: '',
      footer_links_label: 'شروط الاستخدام و سياسة الخصوصية',
      footer_note: 'تابعنا أو تواصل معنا عبر القنوات التالية:',
      footer_secondary_note: 'جميع الحقوق محفوظة لموقع مطابقة',
      footer_brand_name: 'Mutabaka',
      footer_year_override: '',
      footer_year: new Date().getFullYear().toString(),
      login_logo_url: null,
      qr_overlay_logo_url: null,
      instructions: [
        { id: null, title: '', description: 'افتح تطبيق مطابقة على هاتفك النقّال', icon_hint: 'app', display_order: 1 },
        { id: null, title: '', description: 'اضغط على زر القائمة ⋮ في التطبيق', icon_hint: 'menu', display_order: 2 },
        { id: null, title: '', description: 'اذهب إلى قسم الأجهزة المرتبطة ثم اختر ربط جهاز', icon_hint: 'devices', display_order: 3 },
        { id: null, title: '', description: 'وجّه الكاميرا نحو رمز QR ليتم تسجيل دخولك تلقائيًا', icon_hint: 'scan', display_order: 4 },
      ],
    });

    const defaults = fallback();

    try {
      const payload = await this.getLoginPagePayload();
      if (!payload) return defaults;

      const sanitize = (value: string | null | undefined, fallback: string | null = null): string | null => {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed.length > 0) return trimmed;
        }
        if (typeof fallback === 'string' && fallback.trim().length > 0) {
          return fallback.trim();
        }
        return null;
      };

      const mapInstructions = (): LoginInstructionConfig[] => {
        const items = Array.isArray(payload.instructions) ? payload.instructions : [];
        return items
          .map((item, idx) => {
            const description = sanitize(item?.description, null);
            if (!description) return null;
            const title = sanitize(item?.title, '') || '';
            const iconHint = sanitize(item?.icon_hint, null);
            const orderRaw = Number.isFinite(item?.display_order) ? Number(item.display_order) : Number(item?.display_order ?? idx + 1);
            const display_order = Number.isFinite(orderRaw) ? Number(orderRaw) : idx + 1;
            const id = Number.isFinite(item?.id) ? Number(item.id) : (Number.isFinite(Number(item?.id)) ? Number(item?.id) : null);
            return {
              id,
              title,
              description,
              icon_hint: iconHint,
              display_order,
            } as LoginInstructionConfig;
          })
          .filter((entry): entry is LoginInstructionConfig => Boolean(entry));
      };

      const instructions = mapInstructions();

      const config: LoginPageConfig = {
        id: Number.isFinite(payload.id) ? Number(payload.id) : null,
        hero_title: sanitize(payload.hero_title, defaults.hero_title) || defaults.hero_title,
        hero_description: sanitize(payload.hero_description, defaults.hero_description) || defaults.hero_description,
        instructions_title: sanitize(payload.instructions_title, defaults.instructions_title) || defaults.instructions_title,
        stay_logged_in_label: sanitize(payload.stay_logged_in_label, defaults.stay_logged_in_label) || defaults.stay_logged_in_label,
        stay_logged_in_hint: sanitize(payload.stay_logged_in_hint, defaults.stay_logged_in_hint) || defaults.stay_logged_in_hint,
        alternate_login_label: sanitize(payload.alternate_login_label, defaults.alternate_login_label) || defaults.alternate_login_label,
        alternate_login_url: sanitize(payload.alternate_login_url, null),
        footer_links_label: sanitize(payload.footer_links_label, defaults.footer_links_label) || defaults.footer_links_label,
        footer_note: sanitize(payload.footer_note, defaults.footer_note) || defaults.footer_note,
        footer_secondary_note: sanitize(payload.footer_secondary_note, defaults.footer_secondary_note) || defaults.footer_secondary_note,
        footer_brand_name: sanitize(payload.footer_brand_name, defaults.footer_brand_name) || defaults.footer_brand_name,
        footer_year_override: sanitize(payload.footer_year_override, null),
        footer_year: sanitize(payload.footer_year, defaults.footer_year) || defaults.footer_year,
        login_logo_url: sanitize(payload.login_logo_url, null),
        qr_overlay_logo_url: sanitize(payload.qr_overlay_logo_url, null),
        instructions: instructions.length > 0 ? instructions : defaults.instructions.slice(),
      };

      return config;
    } catch {
      return defaults;
    }
  }

  async getLoginQrPayload(): Promise<LoginQrPayload> {
    const fallback = (): LoginQrPayload => ({
      payload: `mutabaka://link?token=${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
      expires_in: 60,
      request_id: null,
    });

    try {
      const res = await fetch(`${this.baseUrl}/api/auth/login-qr/create`);
      if (!res.ok) {
        return fallback();
      }
      const data = await res.json().catch(() => null);
      if (!data || typeof data !== 'object') return fallback();
      const payloadRaw = (data as any).payload || (data as any).qr_payload || (data as any).url || (data as any).qr;
      const payload = typeof payloadRaw === 'string' && payloadRaw.trim().length ? payloadRaw.trim() : null;
      const expiresRaw = (data as any).expires_in ?? (data as any).expiresIn ?? (data as any).ttl ?? 60;
      const expires = Number(expiresRaw);
      const requestId = (data as any).request_id || null;
      return {
        payload: payload || fallback().payload,
        expires_in: Number.isFinite(expires) && expires > 5 ? expires : fallback().expires_in,
        request_id: requestId,
      };
    } catch {
      return fallback();
    }
  }

  async checkLoginQrStatus(requestId: string): Promise<{ status: string; access?: string; refresh?: string; user?: any }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/auth/login-qr/${requestId}/status`);
      const data = await res.json().catch(() => ({ status: 'error' }));
      return data;
    } catch {
      return { status: 'error' };
    }
  }

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

  async getPolicyDocument(documentType: 'privacy' | 'terms' = 'privacy'): Promise<{ id: number; title: string; content: string; document_type: string; updated_at: string } | null> {
    try {
      const params = new URLSearchParams();
      if (documentType !== 'privacy') {
        params.set('type', documentType);
      }
      const query = params.toString();
      const res = await fetch(`${this.baseUrl}/api/privacy-policy${query ? `?${query}` : ''}`);
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      if (!data || typeof data !== 'object') return null;
      const id = typeof data.id === 'number' ? data.id : Number(data.id ?? 0);
      const title = typeof data.title === 'string' ? data.title : '';
      const content = typeof data.content === 'string' ? data.content : '';
      const updated = typeof data.updated_at === 'string' ? data.updated_at : '';
      const docType = typeof data.document_type === 'string' ? data.document_type : documentType;
      if (!content.trim()) return null;
      return {
        id: Number.isFinite(id) ? Number(id) : 0,
        title,
        content,
        document_type: docType,
        updated_at: updated,
      };
    } catch {
      return null;
    }
  }

  async getPrivacyPolicy(): Promise<{ id: number; title: string; content: string; document_type: string; updated_at: string } | null> {
    return this.getPolicyDocument('privacy');
  }

  async getTermsOfUse(): Promise<{ id: number; title: string; content: string; document_type: string; updated_at: string } | null> {
    return this.getPolicyDocument('terms');
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
