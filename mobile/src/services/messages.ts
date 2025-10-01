import { request } from '../lib/httpClient';

export interface MessageDto {
  id: number;
  conversation: number;
  sender?: {
    id: number;
    username: string;
    display_name?: string | null;
    email?: string;
  };
  senderType: 'team_member' | 'user';
  senderDisplay: string;
  type: string;
  body: string;
  created_at: string;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_mime?: string | null;
  attachment_size?: number | null;
  status?: 'sent' | 'delivered' | 'read';
  delivery_status?: number;
  delivered_at?: string | null;
  read_at?: string | null;
  delivery_context?: 'passive' | 'active' | null;
  system_subtype?: string | null;
  systemSubtype?: string | null;
  settled_at?: string | null;
  settledAt?: string | null;
  metadata?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
  extra?: Record<string, unknown> | null;
}

interface MessagesResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: MessageDto[];
}

export interface UploadAttachmentAsset {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  fileCopyUri?: string | null;
  size?: number | null;
}

export async function fetchMessages(conversationId: number): Promise<MessagesResponse> {
  return request<MessagesResponse>({
    path: 'messages/',
    method: 'GET',
    query: { conversation: conversationId },
  });
}

export async function sendMessage(conversationId: number, body: string, otpCode?: string): Promise<MessageDto> {
  const headers: Record<string, string> = {};
  if (otpCode) {
    headers['X-OTP-Code'] = otpCode;
  }
  return request<MessageDto, { body: string }>({
    path: `conversations/${conversationId}/send/`,
    method: 'POST',
    body: { body },
    headers,
  });
}

export async function sendAttachment(
  conversationId: number,
  asset: UploadAttachmentAsset,
  caption?: string,
  otpCode?: string,
): Promise<MessageDto> {
  const headers: Record<string, string> = {};
  if (otpCode) {
    headers['X-OTP-Code'] = otpCode;
  }
  const form = new FormData();
  const fileUri = asset.fileCopyUri || asset.uri;
  if (!fileUri) {
    throw new Error('Invalid attachment: missing file URI');
  }
  form.append('file', {
    uri: fileUri,
    name: asset.name || 'attachment',
    type: asset.mimeType || 'application/octet-stream',
  } as unknown as Blob);
  if (caption && caption.trim()) {
    form.append('body', caption.trim());
  }
  return request<MessageDto, FormData>({
    path: `conversations/${conversationId}/send_attachment/`,
    method: 'POST',
    body: form,
    headers,
  });
}

export async function fetchMessagesSince(
  conversationId: number,
  sinceId: number,
  limit = 50,
): Promise<MessageDto[]> {
  const query: Record<string, string | number | boolean | undefined | null> = {
    limit: Math.max(1, limit),
  };
  if (Number.isFinite(sinceId) && sinceId > 0) {
    query.since_id = sinceId;
  }
  const response = await request<MessageDto[] | { results?: MessageDto[] }>(
    {
      path: `conversations/${conversationId}/messages/`,
      method: 'GET',
      query,
    },
  );
  if (Array.isArray(response)) {
    return response;
  }
  if (response && Array.isArray(response.results)) {
    return response.results;
  }
  return [];
}
