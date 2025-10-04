import { HttpError, request } from '../lib/httpClient';

export interface ApproveWebLoginParams {
  payload: string;
  accessToken: string;
  deviceId: string;
  label?: string;
}

export interface ApproveWebLoginResponse {
  detail: string;
  request_id: string;
  device_id: string;
}

/**
 * Approve a web login session by scanning QR code
 */
export async function approveWebLogin(params: ApproveWebLoginParams): Promise<ApproveWebLoginResponse> {
  const { payload, accessToken, deviceId, label = 'متصفح الويب' } = params;

  try {
    const response = await request<ApproveWebLoginResponse>({
      path: 'auth/login-qr/approve',
      method: 'POST',
      body: {
        payload,
        label,
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Device-ID': deviceId,
      },
      auth: false, // نحن نضيف Authorization يدوياً
    });

    return response;
  } catch (error) {
    if (error instanceof HttpError) {
      const detail = typeof error.payload === 'object' && error.payload && 'detail' in error.payload
        ? String((error.payload as Record<string, unknown>).detail)
        : error.message;
      
      if (detail === 'expired' || detail.includes('expired')) {
        throw new Error('expired');
      }
      if (detail === 'already_consumed' || detail === 'already_approved') {
        throw new Error('already_used');
      }
      if (detail === 'token_mismatch' || detail === 'session_not_found') {
        throw new Error('invalid_token');
      }
      
      throw new Error(detail);
    }
    
    throw error;
  }
}
