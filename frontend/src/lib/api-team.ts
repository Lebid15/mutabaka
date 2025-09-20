export type PublicUser = { id: number; username: string; display_name?: string | null };
export type TeamMember = { id: number; owner?: PublicUser; member: PublicUser; display_name: string; phone: string };

export async function listTeam(token: string) {
  const res = await fetch('/api/team/', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Failed to list team');
  return (await res.json()) as TeamMember[];
}

export async function createTeamMember(token: string, payload: { username: string; display_name?: string; phone?: string }) {
  const res = await fetch('/api/team/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to create team member');
  return (await res.json()) as TeamMember;
}

export async function updateTeamMember(token: string, id: number, payload: Partial<{ display_name: string; phone: string }>) {
  const res = await fetch(`/api/team/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to update team member');
  return (await res.json()) as TeamMember;
}

export async function deleteTeamMember(token: string, id: number) {
  const res = await fetch(`/api/team/${id}/`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Failed to delete team member');
}

export async function listConversationMembers(token: string, conversationId: number) {
  const res = await fetch(`/api/conversations/${conversationId}/members/`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Failed to fetch conversation members');
  return (await res.json()) as { members: Array<{ id: number; username: string; display_name: string; role: 'participant' | 'team' }>; };
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

export async function removeMemberFromConversation(token: string, conversationId: number, memberId: number) {
  const res = await fetch(`/api/conversations/${conversationId}/remove_member/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ member_id: memberId }),
  });
  if (!res.ok) throw new Error('Failed to remove member');
  return await res.json();
}
