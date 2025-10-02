let inMemoryTokens: AuthTokens | null = null;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export async function storeAuthTokens(tokens: AuthTokens): Promise<void> {
  inMemoryTokens = tokens;
}

export async function getAccessToken(): Promise<string | null> {
  return inMemoryTokens?.accessToken || null;
}

export async function getRefreshToken(): Promise<string | null> {
  return inMemoryTokens?.refreshToken || null;
}

export async function clearAuthTokens(): Promise<void> {
  inMemoryTokens = null;
}

export function hasUnlockedTokens(): boolean {
  return Boolean(inMemoryTokens?.accessToken && inMemoryTokens?.refreshToken);
}

export function setUnlockedTokens(tokens: AuthTokens | null): void {
  inMemoryTokens = tokens;
}
