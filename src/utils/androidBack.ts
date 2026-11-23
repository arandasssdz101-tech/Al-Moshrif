import { App as CapacitorApp } from '@capacitor/app';
import { isNativeApp } from '@/utils/platform';

type BackHandler = () => boolean | void;

const stack: BackHandler[] = [];
let listenerAttached = false;

function ensureNativeListener(): void {
  if (!isNativeApp || listenerAttached) return;
  listenerAttached = true;

  void CapacitorApp.addListener('backButton', () => {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const handled = stack[i]();
      if (handled !== false) {
        return;
      }
    }
    void CapacitorApp.minimizeApp().catch(() => undefined);
  }).catch(() => {
    listenerAttached = false;
  });
}

/**
 * Registers an Android hardware/gesture back-button handler on a LIFO stack.
 * Only the top-most active overlay or screen consumes each back press.
 * Return `false` from the handler to pass the event down the stack.
 */
export function registerAndroidBackHandler(handler: BackHandler): () => void {
  if (!isNativeApp) return () => {};
  ensureNativeListener();
  stack.push(handler);
  return () => {
    const idx = stack.lastIndexOf(handler);
    if (idx !== -1) {
      stack.splice(idx, 1);
    }
  };
}
