import { request, HttpError } from '../lib/httpClient';

export interface TeamMember {
  id: number;
  username: string;
  display_name?: string | null;
  phone?: string | null;
  owner?: {
    id: number;
    username: string;
    display_name?: string | null;
  } | null;
  is_active?: boolean;
}

export interface CreateTeamMemberPayload {
  username: string;
  display_name?: string | null;
  phone?: string | null;
  password: string;
}

export interface UpdateTeamMemberPayload {
  display_name?: string | null;
  phone?: string | null;
  password?: string | null;
}

export async function listTeamMembers(): Promise<TeamMember[]> {
  return request<unknown>({
    path: 'team/',
    method: 'GET',
  }).then((data) => {
    if (Array.isArray(data)) {
      return data as TeamMember[];
    }
    if (data && typeof data === 'object' && Array.isArray((data as any).results)) {
      return (data as any).results as TeamMember[];
    }
    return [];
  }).catch((error) => {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(500, 'تعذر تحميل الفريق', error);
  });
}

export async function createTeamMember(payload: CreateTeamMemberPayload): Promise<TeamMember> {
  return request<TeamMember, CreateTeamMemberPayload>({
    path: 'team/',
    method: 'POST',
    body: payload,
  });
}

export async function updateTeamMember(id: number, payload: UpdateTeamMemberPayload): Promise<TeamMember> {
  return request<TeamMember, UpdateTeamMemberPayload>({
    path: `team/${id}/`,
    method: 'PATCH',
    body: payload,
  });
}

export async function deleteTeamMember(id: number): Promise<void> {
  await request<void>({
    path: `team/${id}/`,
    method: 'DELETE',
    skipJson: true,
  });
}
