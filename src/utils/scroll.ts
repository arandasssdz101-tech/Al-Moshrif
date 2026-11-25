/**
 * Safe scrollIntoView wrapper for older Android WebViews (Chrome < 61)
 * where passing a ScrollIntoViewOptions dictionary may throw a TypeError.
 */
export function safeScrollIntoView(
  el: Element | null | undefined,
  options?: ScrollIntoViewOptions,
): void {
  if (!el || typeof el.scrollIntoView !== 'function') return;
  try {
    el.scrollIntoView(options);
  } catch {
    el.scrollIntoView(options?.block !== 'end');
  }
}
