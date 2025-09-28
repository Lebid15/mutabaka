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
}

interface MessagesResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: MessageDto[];
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
