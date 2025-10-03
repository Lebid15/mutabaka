type EnvironmentName = 'development' | 'staging' | 'production';

interface EnvironmentConfig {
  apiBaseUrl: string;
  websocketBaseUrl: string;
  tenantHost: string;
}

const DEFAULT_ENV: EnvironmentName = 'production';

function normalizeUrl(value: string | undefined | null): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.trim().replace(/\/$/, '');
}

const PRESET_CONFIGS: Record<EnvironmentName, EnvironmentConfig> = {
  development: {
    apiBaseUrl: 'http://10.0.2.2:8000/api',  // Android Emulator localhost
    websocketBaseUrl: 'ws://10.0.2.2:8000/ws',
    tenantHost: 'localhost',
  },
  staging: {
    apiBaseUrl: 'https://staging.mutabaka.com/api',
    websocketBaseUrl: 'wss://staging.mutabaka.com/ws',
    tenantHost: 'staging.mutabaka.com',
  },
  production: {
    apiBaseUrl: 'https://mutabaka.com/api',
    websocketBaseUrl: 'wss://mutabaka.com/ws',
    tenantHost: 'mutabaka.com',
  },
};

const ENVIRONMENT_NAME = (process.env.EXPO_PUBLIC_APP_ENV as EnvironmentName) || DEFAULT_ENV;

const OVERRIDES: Partial<EnvironmentConfig> = {
  apiBaseUrl: normalizeUrl(process.env.EXPO_PUBLIC_API_BASE_URL),
  websocketBaseUrl: normalizeUrl(process.env.EXPO_PUBLIC_WS_BASE_URL),
  tenantHost: process.env.EXPO_PUBLIC_TENANT_HOST?.trim(),
};

const FALLBACK_CONFIG: EnvironmentConfig = PRESET_CONFIGS[DEFAULT_ENV];

function resolveConfig(): EnvironmentConfig {
  const base = PRESET_CONFIGS[ENVIRONMENT_NAME] || FALLBACK_CONFIG;
  const apiBaseUrl = OVERRIDES.apiBaseUrl || base.apiBaseUrl;
  const websocketBaseUrl = OVERRIDES.websocketBaseUrl || base.websocketBaseUrl;
  const tenantHost = OVERRIDES.tenantHost || base.tenantHost;

  console.log('[Mutabaka] Environment resolved', {
    env: ENVIRONMENT_NAME,
    apiBaseUrl,
    websocketBaseUrl,
    tenantHost,
  });

  return {
    apiBaseUrl,
    websocketBaseUrl,
    tenantHost,
  };
}

export const environment = {
  name: ENVIRONMENT_NAME,
  ...resolveConfig(),
};

export type { EnvironmentConfig };
