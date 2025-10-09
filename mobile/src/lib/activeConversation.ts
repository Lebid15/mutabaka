let activeConversationId: number | null = null;
let appForeground = false;

function normalizeConversationId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

export function setActiveConversationId(value: unknown): void {
  activeConversationId = normalizeConversationId(value);
}

export function clearActiveConversationId(): void {
  activeConversationId = null;
}

export function getActiveConversationId(): number | null {
  return activeConversationId;
}

export function setAppForegroundState(isForeground: boolean): void {
  appForeground = Boolean(isForeground);
}

export function isAppInForeground(): boolean {
  return appForeground;
}
