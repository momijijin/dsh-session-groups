/**
 * Host-side revision fan-out for browser clients.
 *
 * Native-tool and HTTP commits both update the Host store. Without a push
 * channel the sidebar's client-side snapshot stays stale until a reload. This
 * hub is intentionally small: one SSE response per connected browser and a
 * revision-only payload; the client refetches through its normal load route.
 */
export const createChangeHub = () => {
  const clients = new Set()
  let closed = false

  const publish = (revision, source = 'host') => {
    if (closed || !Number.isInteger(revision) || revision < 0) return
    const payload = `event: revision\ndata: ${JSON.stringify({ revision, source })}\n\n`
    for (const client of [...clients]) {
      try {
        client.write(payload)
      } catch {
        clients.delete(client)
      }
    }
  }

  const subscribe = (client) => {
    if (closed) return () => {}
    clients.add(client)
    return () => {
      clients.delete(client)
    }
  }

  const close = () => {
    if (closed) return
    closed = true
    for (const client of [...clients]) {
      try {
        client.end()
      } catch {
        /* detached response */
      }
    }
    clients.clear()
  }

  return { publish, subscribe, close, get size() { return clients.size } }
}
