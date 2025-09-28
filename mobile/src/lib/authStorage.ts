import AsyncStorage from '@react-native-async-storage/async-storage';

const ACCESS_TOKEN_KEY = '@mutabaka/access-token';
const REFRESH_TOKEN_KEY = '@mutabaka/refresh-token';

let inMemoryTokens: AuthTokens | null = null;

async function hydrateCacheFromStorage(): Promise<void> {
  if (inMemoryTokens) {
    return;
  }
  const entries = await AsyncStorage.multiGet([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY]);
  const access = entries.find(([key]) => key === ACCESS_TOKEN_KEY)?.[1] || null;
  const refresh = entries.find(([key]) => key === REFRESH_TOKEN_KEY)?.[1] || null;
  if (access && refresh) {
    inMemoryTokens = { accessToken: access, refreshToken: refresh };
  }
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export async function storeAuthTokens(tokens: AuthTokens): Promise<void> {
  inMemoryTokens = tokens;
  await AsyncStorage.multiSet([
    [ACCESS_TOKEN_KEY, tokens.accessToken],
    [REFRESH_TOKEN_KEY, tokens.refreshToken],
  ]);
}

export async function getAccessToken(): Promise<string | null> {
  if (inMemoryTokens?.accessToken) {
    return inMemoryTokens.accessToken;
  }
  await hydrateCacheFromStorage();
  return inMemoryTokens?.accessToken || null;
}

export async function getRefreshToken(): Promise<string | null> {
  if (inMemoryTokens?.refreshToken) {
    return inMemoryTokens.refreshToken;
  }
  await hydrateCacheFromStorage();
  return inMemoryTokens?.refreshToken || null;
}

export async function clearAuthTokens(): Promise<void> {
  inMemoryTokens = null;
  await AsyncStorage.multiRemove([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY]);
}
