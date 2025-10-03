import { request, HttpError } from '../lib/httpClient';
import { clearAuthTokens } from '../lib/authStorage';
import { clearAll as clearPinSession } from '../lib/pinSession';
import { clearAppBadge } from '../lib/appBadge';
import { clearCachedPushToken } from '../lib/pushNotifications';

type LoginPayload = {
  identifier: string;
  password: string;
};

type TeamLoginPayload = {
  ownerUsername: string;
  teamUsername: string;
  password: string;
};

export interface LoginResponse {
  access: string;
  refresh?: string;
  device_id?: string;
  device_status?: string;
  device_registration_required?: boolean;
  pin?: string;
  pin_required?: boolean;
  [key: string]: unknown;
}

export interface LoginOptions {
  includeDeviceId?: boolean;
}

export class AuthenticationError extends Error {
  status: number;
  code?: string;
  payload?: unknown;

  constructor(message: string, status: number, code?: string, payload?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

function normalizeErrorMessage(error: HttpError): { message: string; code?: string } {
  if (error.status === 0) {
    return {
      message: 'تعذر الاتصال بالخادم. يرجى التحقق من اتصال الإنترنت وإعدادات العنوان.',
      code: 'network_unavailable',
    };
  }

  let detail: string | null = null;
  let code: string | undefined;

  if (error.payload && typeof error.payload === 'object') {
    const payload = error.payload as Record<string, unknown>;
    if (typeof payload.detail === 'string') {
      detail = payload.detail;
      code = payload.detail;
    } else if (typeof payload.detail === 'object' && payload.detail !== null) {
      const innerDetail = (payload.detail as Record<string, unknown>).detail;
      if (typeof innerDetail === 'string') {
        detail = innerDetail;
        code = innerDetail;
      }
    }

    if (!code) {
      const flagged = Object.entries(payload).find(([, value]) => value === true);
      if (flagged) {
        code = flagged[0];
      }
    }

    if (!detail) {
      const firstString = Object.values(payload).find((value) => typeof value === 'string');
      if (typeof firstString === 'string') {
        detail = firstString;
      }
    }
  }

  if (!code) {
    if (error.status === 401) {
      code = 'unauthorized';
    } else if (error.status === 403) {
      code = 'forbidden';
    }
  }

  const message = (() => {
    switch (detail) {
      case 'device_pending':
        return 'هذا الجهاز بانتظار موافقة المالك الأساسية.';
      case 'device_revoked':
        return 'تم إلغاء تفعيل هذا الجهاز. تواصل مع المالك لإعادة تفعيله.';
      case 'device_unknown':
      case 'device_not_active':
        return 'الجهاز الحالي غير معرّف أو غير مفعل للحساب.';
      case 'device_limit_reached':
        return 'تم الوصول إلى الحد الأقصى من الأجهزة النشطة. اطلب من المالك استبدال أحد الأجهزة.';
      case 'No active account found':
        return 'بيانات الدخول غير صحيحة.';
      default:
        if (detail && detail.length > 0) {
          return detail;
        }
    }
    if (error.status === 401) {
      return 'بيانات الدخول غير صحيحة أو انتهت صلاحيتها.';
    }
    if (error.status === 403) {
      return 'لا تملك صلاحية تنفيذ هذا الإجراء.';
    }
    return error.message || 'تعذر إتمام الطلب.';
  })();

  return { message, code };
}

function toAuthError(error: HttpError): AuthenticationError {
  const { message, code } = normalizeErrorMessage(error);
  return new AuthenticationError(message, error.status, code, error.payload);
}

export async function loginWithIdentifier(payload: LoginPayload, options?: LoginOptions): Promise<LoginResponse> {
  try {
    return await request<LoginResponse, Record<string, string>>({
      path: 'auth/token/',
      method: 'POST',
      auth: false,
      deviceId: options?.includeDeviceId === false ? false : undefined,
      body: {
        username: payload.identifier,
        password: payload.password,
      },
    });
  } catch (error) {
    if (error instanceof HttpError) {
      throw toAuthError(error);
    }
    throw error;
  }
}

export async function loginAsTeamMember(payload: TeamLoginPayload, options?: LoginOptions): Promise<LoginResponse> {
  try {
    return await request<LoginResponse, Record<string, string>>({
      path: 'auth/team/login',
      method: 'POST',
      auth: false,
      deviceId: options?.includeDeviceId === false ? false : undefined,
      body: {
        owner_username: payload.ownerUsername,
        team_username: payload.teamUsername,
        password: payload.password,
      },
    });
  } catch (error) {
    if (error instanceof HttpError) {
      throw toAuthError(error);
    }
    throw error;
  }
}

export type LoginCredentials =
  | { mode: 'user'; identifier: string; password: string }
  | { mode: 'team'; ownerUsername: string; teamUsername: string; password: string };

export async function performLogin(credentials: LoginCredentials, options?: LoginOptions): Promise<LoginResponse> {
  if (credentials.mode === 'team') {
    return loginAsTeamMember({
      ownerUsername: credentials.ownerUsername,
      teamUsername: credentials.teamUsername,
      password: credentials.password,
    }, options);
  }
  return loginWithIdentifier({
    identifier: credentials.identifier,
    password: credentials.password,
  }, options);
}

export async function logout(options?: { wipePinSession?: boolean }): Promise<void> {
  await clearAuthTokens();
  if (options?.wipePinSession) {
    await clearPinSession();
  }
  try {
    await clearAppBadge();
  } catch (error) {
    console.warn('[Mutabaka] Failed to clear app badge on logout', error);
  }
  // مسح cached push token
  clearCachedPushToken();
}
