/**
 * Small adapter around EventSource so reconnect behavior is injectable in
 * tests. The browser owns retry/backoff; this adapter only wires the revision
 * listener and the reconnect notification.
 */
export const createChangeStream = ({
  EventSourceImpl = globalThis.EventSource,
  url,
  onRevision,
  onOpen,
  onError,
  withCredentials = true,
} = {}) => {
  if (typeof EventSourceImpl !== 'function' || typeof url !== 'string' || url === '') return null
  let source
  try {
    source = new EventSourceImpl(url, { withCredentials })
  } catch {
    return null
  }
  const revisionListener = (event) => onRevision?.(event)
  source.addEventListener?.('revision', revisionListener)
  source.onopen = () => onOpen?.()
  source.onerror = (event) => onError?.(event)
  return {
    source,
    close() {
      try {
        source.removeEventListener?.('revision', revisionListener)
      } catch {
        /* ignore */
      }
      try {
        source.close?.()
      } catch {
        /* ignore */
      }
    },
  }
}
