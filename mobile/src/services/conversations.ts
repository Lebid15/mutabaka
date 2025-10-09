import { request } from '../lib/httpClient';

export interface ConversationUser {
  id: number;
  username: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  logo_url?: string | null;
}

export interface ConversationDto {
  id: number;
  user_a: ConversationUser;
  user_b: ConversationUser;
  created_at: string;
  last_message_at: string | null;
  last_activity_at: string | null;
  last_message_preview: string | null;
  mutedUntil: string | null;
  isMuted: boolean;
  unread_count?: number;
  unreadCount?: number;
  delete_requested_by?: ConversationUser | number | null;
  delete_requested_by_id?: number | null;
  delete_requested_at?: string | null;
  deleteRequestedBy?: ConversationUser | number | null;
  deleteRequestedById?: number | null;
  deleteRequestedAt?: string | null;
}

export interface ConversationMemberSummary {
  id: number;
  username: string;
  display_name?: string | null;
  role: 'participant' | 'team' | 'team_member';
}

interface ConversationMembersResponse {
  members?: ConversationMemberSummary[];
}

interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface FetchConversationsOptions {
  page?: number;
  pageSize?: number;
  search?: string;
}

export async function fetchConversations(options?: FetchConversationsOptions): Promise<PaginatedResponse<ConversationDto>> {
  const { page, pageSize, search } = options || {};
  return request<PaginatedResponse<ConversationDto>>({
    path: 'conversations/',
    method: 'GET',
    query: {
      page,
      page_size: pageSize,
      search,
    },
  });
}

export async function fetchConversation(conversationId: number): Promise<ConversationDto> {
  return request<ConversationDto>({
    path: `conversations/${conversationId}/`,
    method: 'GET',
  });
}

export async function createConversationByUsername(username: string): Promise<ConversationDto> {
  return request<ConversationDto, { other_user_username: string }>({
    path: 'conversations/',
    method: 'POST',
    body: { other_user_username: username },
  });
}

export interface NetBalanceEntry {
  currency?: {
    id?: number;
    code?: string;
    name?: string;
  } | null;
  net_from_user_a_perspective?: string | number | null;
}

export interface NetBalanceResponse {
  net?: NetBalanceEntry[];
}

export async function fetchNetBalance(conversationId: number): Promise<NetBalanceResponse> {
  return request<NetBalanceResponse>({
    path: `conversations/${conversationId}/net_balance/`,
    method: 'GET',
  });
}

export async function clearConversation(conversationId: number): Promise<{ status: string; deleted_messages: number }> {
  return request<{ status: string; deleted_messages: number }>({
    path: `conversations/${conversationId}/clear/`,
    method: 'POST',
  });
}

export async function muteConversation(conversationId: number): Promise<{ mutedUntil: string | null }> {
  return request<{ mutedUntil: string | null }>({
    path: `conversations/${conversationId}/mute/`,
    method: 'POST',
  });
}

export async function unmuteConversation(conversationId: number): Promise<{ mutedUntil: string | null }> {
  return request<{ mutedUntil: string | null }>({
    path: `conversations/${conversationId}/mute/`,
    method: 'DELETE',
  });
}

export async function requestDeleteConversation(conversationId: number, otpCode?: string): Promise<{ status: string }> {
  const headers: Record<string, string> = {};
  if (otpCode) {
    headers['X-OTP-Code'] = otpCode;
  }
  return request<{ status: string }>({
    path: `conversations/${conversationId}/request_delete/`,
    method: 'POST',
    headers,
  });
}

export async function approveDeleteConversation(conversationId: number): Promise<{ status: string }> {
  return request<{ status: string }>({
    path: `conversations/${conversationId}/approve_delete/`,
    method: 'POST',
  });
}

export async function declineDeleteConversation(conversationId: number): Promise<{ status: string }> {
  return request<{ status: string }>({
    path: `conversations/${conversationId}/decline_delete/`,
    method: 'POST',
  });
}

export async function fetchConversationMembers(conversationId: number): Promise<ConversationMemberSummary[]> {
  const response = await request<ConversationMembersResponse>({
    path: `conversations/${conversationId}/members/`,
    method: 'GET',
  });
  if (response && Array.isArray(response.members)) {
    return response.members;
  }
  return [];
}

export async function addConversationTeamMember(conversationId: number, teamMemberId: number) {
  return request<{ id: number; type: string; display_name?: string } | undefined, { team_member_id: number }>({
    path: `conversations/${conversationId}/add_team_member/`,
    method: 'POST',
    body: { team_member_id: teamMemberId },
  });
}

export async function removeConversationMember(
  conversationId: number,
  memberId: number,
  memberType: 'user' | 'team_member',
) {
  return request<{ status: string }>({
    path: `conversations/${conversationId}/remove_member/`,
    method: 'POST',
    body: {
      member_id: memberId,
      member_type: memberType,
    },
  });
}

interface UnreadCountResponse {
  unread_count?: number | string | null;
}

export async function fetchUnreadBadgeCount(): Promise<number | null> {
  const response = await request<UnreadCountResponse>({
    path: 'inbox/unread_count',
    method: 'GET',
  });

  const raw = response?.unread_count;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 0 ? 0 : Math.floor(raw);
  }
  if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed < 0 ? 0 : parsed;
    }
  }
  return null;
}
