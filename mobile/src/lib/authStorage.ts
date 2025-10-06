let inMemoryTokens: AuthTokens | null = null;

type AuthTokensListener = (tokens: AuthTokens | null) => void;

const listeners = new Set<AuthTokensListener>();

function notifyListeners(): void {
  listeners.forEach((listener) => {
    try {
      listener(inMemoryTokens);
    } catch (error) {
      console.warn('[Mutabaka] authStorage listener failed', error);
    }
  });
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export async function storeAuthTokens(tokens: AuthTokens): Promise<void> {
  inMemoryTokens = tokens;
  notifyListeners();
}

export async function getAccessToken(): Promise<string | null> {
  return inMemoryTokens?.accessToken || null;
}

export async function getRefreshToken(): Promise<string | null> {
  return inMemoryTokens?.refreshToken || null;
}

export async function clearAuthTokens(): Promise<void> {
  inMemoryTokens = null;
  notifyListeners();
}

export function hasUnlockedTokens(): boolean {
  return Boolean(inMemoryTokens?.accessToken && inMemoryTokens?.refreshToken);
}

export function setUnlockedTokens(tokens: AuthTokens | null): void {
  inMemoryTokens = tokens;
  notifyListeners();
}

export function subscribeToAuthTokenChanges(listener: AuthTokensListener, options?: { immediate?: boolean }): () => void {
  listeners.add(listener);
  if (options?.immediate ?? true) {
    try {
      listener(inMemoryTokens);
    } catch (error) {
      console.warn('[Mutabaka] authStorage immediate listener failed', error);
    }
  }
  return () => {
    listeners.delete(listener);
  };
}
