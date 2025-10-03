import { request } from '../lib/httpClient';

export interface CurrentUser {
  id: number;
  username: string;
  display_name: string | null;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  country_code?: string | null;
  initials: string;
  logo_url: string | null;
  subscription_remaining_days: number;
  created_by_id?: number | null;
  is_team_member?: boolean;
}

export interface PublicUser {
  id: number;
  username: string;
  display_name: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  logo_url?: string | null;
}

export async function fetchCurrentUser(): Promise<CurrentUser> {
  return request<CurrentUser>({
    path: 'auth/me/',
    method: 'GET',
  });
}

export async function searchUsers(query: string, options?: { excludeSelf?: boolean }): Promise<PublicUser[]> {
  return request<unknown>({
    path: 'users/',
    method: 'GET',
    query: {
      q: query,
      exclude_self: options?.excludeSelf === false ? undefined : 1,
    },
  }).then((data) => {
    if (Array.isArray(data)) {
      return data as PublicUser[];
    }
    if (data && typeof data === 'object' && Array.isArray((data as any).results)) {
      return (data as any).results as PublicUser[];
    }
    return [];
  }).catch((error) => {
    console.warn('[Mutabaka] searchUsers failed', error);
    throw error;
  });
}

export interface UpdateProfilePayload {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  display_name?: string | null;
}

export async function updateProfile(payload: UpdateProfilePayload): Promise<CurrentUser> {
  return request<CurrentUser, UpdateProfilePayload>({
    path: 'auth/me/',
    method: 'PATCH',
    body: payload,
  });
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<{ detail?: string }> {
  return request<{ detail?: string }, { old_password: string; new_password: string }>({
    path: 'auth/me/',
    method: 'POST',
    query: { action: 'change_password' },
    body: {
      old_password: oldPassword,
      new_password: newPassword,
    },
  });
}

interface UploadProfilePhotoOptions {
  uri: string;
  name?: string;
  mimeType?: string;
}

export async function uploadProfilePhoto({ uri, name, mimeType }: UploadProfilePhotoOptions): Promise<{ detail?: string; logo_url?: string | null }> {
  const formData = new FormData();
  formData.append('action', 'upload_logo');
  formData.append('logo', {
    uri,
    name: name ?? 'avatar.jpg',
    type: mimeType ?? 'image/jpeg',
  } as any);

  return request<{ detail?: string; logo_url?: string | null }, FormData>({
    path: 'auth/me/',
    method: 'POST',
    query: { action: 'upload_logo' },
    body: formData,
  });
}
