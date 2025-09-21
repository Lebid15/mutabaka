export type PublicUser = { id: number; username: string; display_name?: string | null };
export type TeamMember = { id: number; owner?: PublicUser; username: string; display_name: string; phone: string; is_active?: boolean };

function extractErrorMessage(data: any, fallback: string) {
  try {
    if (!data) return fallback;
    if (typeof data === 'string') return data;
    if (data.detail) return String(data.detail);
    if (data.non_field_errors) return String(data.non_field_errors?.[0] || fallback);
    // Common field error shapes from DRF
    for (const key of Object.keys(data)) {
      const v = (data as any)[key];
      if (Array.isArray(v) && v.length) return String(v[0]);
      if (typeof v === 'string') return v;
    }
  } catch {}
  return fallback;
}

export async function listTeam(token: string): Promise<TeamMember[]> {
  const res = await fetch('/api/team/', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Failed to list team');
  const data = await res.json();
  if (Array.isArray(data)) return data as TeamMember[];
  if (data && Array.isArray(data.results)) return data.results as TeamMember[];
  return [];
}

export async function createTeamMember(token: string, payload: { username: string; display_name?: string; phone?: string; password: string }) {
  const res = await fetch('/api/team/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = 'Failed to create team member';
    try { const data = await res.json(); msg = extractErrorMessage(data, msg); } catch {}
    throw new Error(msg);
  }
  return (await res.json()) as TeamMember;
}

export async function updateTeamMember(token: string, id: number, payload: Partial<{ display_name: string; phone: string }>) {
  const res = await fetch(`/api/team/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = 'Failed to update team member';
    try { const data = await res.json(); msg = extractErrorMessage(data, msg); } catch {}
    throw new Error(msg);
  }
  return (await res.json()) as TeamMember;
}

export async function deleteTeamMember(token: string, id: number) {
  const res = await fetch(`/api/team/${id}/`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let msg = 'Failed to delete team member';
    try { const data = await res.json(); msg = extractErrorMessage(data, msg); } catch {}
    throw new Error(msg);
  }
}

export async function listConversationMembers(token: string, conversationId: number) {
  const res = await fetch(`/api/conversations/${conversationId}/members/`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Failed to fetch conversation members');
  // Backend roles can be: 'participant' | 'team' (extra user) | 'team_member'
  return (await res.json()) as { members: Array<{ id: number; username: string; display_name: string; role: 'participant' | 'team' | 'team_member' }>; };
}

export async function addTeamMemberToConversation(token: string, conversationId: number, teamMemberId: number) {
  const res = await fetch(`/api/conversations/${conversationId}/add_team_member/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ team_member_id: teamMemberId }),
  });
  if (!res.ok) throw new Error('Failed to add team member to conversation');
  return await res.json();
}

export async function removeMemberFromConversation(token: string, conversationId: number, memberId: number, memberType: 'user'|'team_member' = 'team_member') {
  const res = await fetch(`/api/conversations/${conversationId}/remove_member/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ member_id: memberId, member_type: memberType }),
  });
  if (!res.ok) throw new Error('Failed to remove member');
  return await res.json();
}
