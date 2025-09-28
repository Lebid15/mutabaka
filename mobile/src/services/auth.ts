import { request, HttpError } from '../lib/httpClient';
import { storeAuthTokens, clearAuthTokens, type AuthTokens } from '../lib/authStorage';

type LoginPayload = {
  identifier: string;
  password: string;
};

type TeamLoginPayload = {
  ownerUsername: string;
  teamUsername: string;
  password: string;
};

type LoginResponse = {
  access: string;
  refresh: string;
};

export async function loginWithIdentifier(payload: LoginPayload): Promise<AuthTokens> {
  try {
    const data = await request<LoginResponse, Record<string, string>>({
      path: 'auth/token/',
      method: 'POST',
      auth: false,
      body: {
        username: payload.identifier,
        password: payload.password,
      },
    });
    const tokens: AuthTokens = {
      accessToken: data.access,
      refreshToken: data.refresh,
    };
    await storeAuthTokens(tokens);
    return tokens;
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 0) {
        throw new Error('تعذر الاتصال بالخادم. تأكد من تشغيل الخادم المحلي وتحديث عنوان IP في ملف البيئة.');
      }
      const detail = typeof error.payload === 'object' && error.payload && 'detail' in error.payload
        ? String((error.payload as Record<string, unknown>).detail)
        : null;
      throw new Error(detail || error.message || 'تعذر تسجيل الدخول');
    }
    throw error;
  }
}

export async function loginAsTeamMember(payload: TeamLoginPayload): Promise<AuthTokens> {
  try {
    const data = await request<{
      access: string;
      refresh: string;
    }, Record<string, string>>({
      path: 'auth/team/login',
      method: 'POST',
      auth: false,
      body: {
        owner_username: payload.ownerUsername,
        team_username: payload.teamUsername,
        password: payload.password,
      },
    });
    const tokens: AuthTokens = {
      accessToken: data.access,
      refreshToken: data.refresh,
    };
    await storeAuthTokens(tokens);
    return tokens;
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 0) {
        throw new Error('تعذر الاتصال بالخادم. تأكد من تشغيل الخادم المحلي وتحديث عنوان IP في ملف البيئة.');
      }
      const detail = typeof error.payload === 'object' && error.payload && 'detail' in error.payload
        ? String((error.payload as Record<string, unknown>).detail)
        : null;
      throw new Error(detail || error.message || 'تعذر تسجيل الدخول');
    }
    throw error;
  }
}

export async function logout(): Promise<void> {
  await clearAuthTokens();
}
