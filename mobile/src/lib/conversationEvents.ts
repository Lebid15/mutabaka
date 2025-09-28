export interface ConversationPreviewUpdate {
  id: number;
  lastMessageAt?: string | null;
  lastActivityAt?: string | null;
  lastMessagePreview?: string | null;
  unreadCount?: number;
}

type Listener = (update: ConversationPreviewUpdate) => void;

const listeners = new Set<Listener>();

export function emitConversationPreviewUpdate(update: ConversationPreviewUpdate): void {
  listeners.forEach((listener) => {
    const invoke = () => {
      try {
        listener(update);
      } catch (error) {
        console.warn('[Mutabaka] conversation preview listener failed', error);
      }
    };

    if (typeof queueMicrotask === 'function') {
      queueMicrotask(invoke);
    } else {
      Promise.resolve().then(invoke).catch((error) => {
        console.warn('[Mutabaka] conversation preview microtask failed', error);
      });
    }
  });
}

export function subscribeToConversationPreviewUpdates(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
