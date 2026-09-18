/** Optional touch feedback; unsupported browsers still get visible press/focus states. */
export function initTouchFeedback() {
  document.addEventListener('click', event => {
    if (!(event instanceof PointerEvent) || event.pointerType !== 'touch' || !event.isTrusted || window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof navigator.vibrate !== 'function') return;
    const target = (event.target as Element).closest<HTMLButtonElement>('button, a');
    if (!target || target.disabled || target.closest('[inert]') || target.matches('[data-shape], .palette, [data-type]')) return;
    try { navigator.vibrate(8); } catch { /* Visual feedback remains available. */ }
  });
}
