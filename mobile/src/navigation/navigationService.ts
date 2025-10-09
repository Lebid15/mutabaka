import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './index';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const pendingActions: Array<() => void> = [];

function flushPending() {
  while (pendingActions.length) {
    const action = pendingActions.shift();
    try {
      action?.();
    } catch (error) {
      console.warn('[NavigationService] Failed to run pending action', error);
    }
  }
}

export function onNavigationReady() {
  flushPending();
}

function runWhenReady(action: () => void) {
  if (navigationRef.isReady()) {
    action();
  } else {
    pendingActions.push(action);
  }
}

export function navigateToConversation(conversationId: string | number) {
  const normalized = typeof conversationId === 'number'
    ? conversationId > 0 ? String(conversationId) : ''
    : typeof conversationId === 'string'
      ? conversationId.trim()
      : '';
  if (!normalized) {
    return;
  }
  runWhenReady(() => {
    if (!navigationRef.isReady()) {
      // إذا لم يكن جاهزاً بعد، نعيد المحاولة لاحقاً
      pendingActions.push(() => navigateToConversation(normalized));
      return;
    }
    try {
      navigationRef.navigate('Chat', { conversationId: normalized });
    } catch (error) {
      console.warn('[NavigationService] Failed to navigate to conversation', normalized, error);
    }
  });
}
