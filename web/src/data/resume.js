// Browsers throttle timers in background tabs and suspend them during sleep.
// Focus, visibility and bfcache restoration all need an immediate fresh poll.
export function onResume(wake) {
  const resume = () => {
    if (globalThis.document?.visibilityState !== 'hidden') wake();
  };
  globalThis.addEventListener?.('focus', resume);
  globalThis.addEventListener?.('pageshow', resume);
  globalThis.document?.addEventListener('visibilitychange', resume);
  return () => {
    globalThis.removeEventListener?.('focus', resume);
    globalThis.removeEventListener?.('pageshow', resume);
    globalThis.document?.removeEventListener('visibilitychange', resume);
  };
}
