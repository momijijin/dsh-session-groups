/**
 * Optimistic document commit queue (0.2.4).
 *
 * Drag/drop used to wait for the HTTP round trip before the view moved: the
 * commit queue resolved the next document against the last *confirmed* doc and
 * dispatched only after `POST /dsh-session-grove/commit` answered, so every
 * reorder paid a full request in perceived latency. This module turns drops into
 * WYSIWYG commits:
 *
 * 1. `commitOptimistic(updater)` resolves the updater against the current
 *    **optimistic** document (the one already on screen), dispatches the next
 *    doc in the same tick, and only then queues the HTTP write. The store
 *    revision stays at the last server-confirmed value, so it is always the
 *    correct `baseRevision`.
 * 2. Writes coalesce: while no request is in flight, every additional optimistic
 *    commit replaces the pending document, so a burst of rapid moves produces
 *    one request carrying the latest document. A write that is already in flight
 *    is followed by exactly one more request for the newest document, never by a
 *    stale intermediate one.
 * 3. Success reconciles the server revision/document. If a newer optimistic
 *    document appeared during the request, the view keeps it and only the
 *    confirmed revision/doc are updated; the next write uses that revision.
 * 4. Failure or conflict rolls the view back to the last confirmed document and
 *    revision and surfaces the existing error toast. The persistence error is
 *    marked `reported` so callers do not toast twice.
 * 5. Non-optimistic commits (create/rename/delete/icon/move dialogs) call
 *    `commitStrict`: it first flushes every pending optimistic write, takes the
 *    single writer lock, and resolves the mutation against the latest document
 *    (never a stale pre-drop snapshot). Optimistic drops that arrive during a
 *    strict write are deferred until it settles and then computed against the
 *    fresh document, so a stale doc can never be written over newer state.
 *
 * The module is DOM-free and injects its store/commit/notify dependencies so the
 * queue semantics are unit-tested without React or the network.
 */

/** Mark a persistence failure as already surfaced by the queue. */
const asReported = (error, code) => {
  const failure = error instanceof Error ? error : new Error(String(error ?? code ?? 'commit-failed'))
  failure.reported = true
  if (code !== undefined && failure.code === undefined) failure.code = code
  return failure
}

const deferred = () => {
  let resolve
  const promise = new Promise((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/**
 * Create the optimistic queue.
 *
 * @param {{
 *   store: { getSnapshot: () => object, dispatch: (action: string, payload?: object) => object },
 *   commit: (doc: object, baseRevision: number) => Promise<object>,
 *   notify?: (toast: { kind: string, message?: string }) => void,
 *   t?: (key: string, params?: object) => string,
 *   onError?: (error: Error) => void,
 * }} deps
 */
export const createOptimisticQueue = ({ store, commit, notify = () => {}, t = (key) => key, onError = null, trace = () => {} }) => {
  /** Latest optimistic document that has not been sent yet (null = idle). */
  let pendingDoc = null
  /** Resolvers for `commitOptimistic` callers of the pending batch. */
  let pendingWaiters = []
  /** Promise of the active drain loop (null = no writer running). */
  let drainPromise = null
  /** Promise gate held while a non-optimistic (strict) write owns the writer. */
  let strictGate = null
  let disposed = false

  const snapshot = () => store.getSnapshot()

  const settle = (waiters, error) => {
    for (const waiter of waiters) {
      if (error) waiter.reject(error)
      else waiter.resolve()
    }
  }

  const surfaceFailure = (error, result) => {
    const code = result?.code ?? error?.code ?? 'commit-failed'
    const failure = asReported(error, code)
    trace('queue.rollback', { code, conflict: code === 'conflict' })
    // Restore the last confirmed doc/revision: optimistic dispatches never
    // changed the revision, so the confirmed revision is still in the store.
    store.dispatch('optimistic-rollback', { code })
    if (code === 'conflict') notify({ kind: 'error', message: t('banner.conflict') })
    else notify({ kind: 'error', message: t('toast.dropFailed') })
    onError?.(failure)
    return failure
  }

  const drain = async () => {
    while (!disposed && pendingDoc !== null && strictGate === null) {
      const sentDoc = pendingDoc
      const waiters = pendingWaiters
      pendingDoc = null
      pendingWaiters = []
      const baseRevision = snapshot().revision
      let result
      trace('queue.send', { revision: baseRevision, events: waiters.length })
      try {
        result = await commit(sentDoc, baseRevision)
      } catch (error) {
        const failure = surfaceFailure(error, null)
        settle(waiters, failure)
        settle(pendingWaiters, failure)
        pendingWaiters = []
        pendingDoc = null
        return
      }
      if (result?.ok === true) {
        // Keep a newer optimistic doc when the user dropped again while this
        // request was in flight; only the confirmed revision/doc are advanced.
        const newerPending = pendingDoc !== null
        trace('queue.reconcile', { revision: result.revision, keepDoc: newerPending })
        store.dispatch('optimistic-confirmed', {
          confirmedDoc: result.doc,
          revision: result.revision,
          keepDoc: newerPending,
        })
        settle(waiters, null)
        continue
      }
      const failure = surfaceFailure(new Error(result?.message ?? result?.code ?? 'commit-failed'), result)
      settle(waiters, failure)
      settle(pendingWaiters, failure)
      pendingWaiters = []
      pendingDoc = null
      return
    }
  }

  const schedule = () => {
    if (disposed || drainPromise !== null || strictGate !== null) return
    drainPromise = Promise.resolve()
      .then(drain)
      .finally(() => {
        drainPromise = null
        if (!disposed && pendingDoc !== null && strictGate === null) schedule()
      })
  }

  /**
   * Queue one optimistic document mutation. The updater runs synchronously
   * against the current optimistic doc and the result is dispatched before this
   * function returns; the returned promise settles when the write persists.
   *
   * @param {object | ((doc: object) => object)} updater
   * @returns {Promise<object>} resolves with the dispatched doc on persist
   */
  const commitOptimistic = (updater) => {
    if (disposed) return Promise.reject(new Error('optimistic-queue-disposed'))
    // A strict writer owns the doc: defer the optimistic mutation until it
    // settles, then resolve against the (fresh) confirmed+optimistic document.
    if (strictGate !== null) {
      trace('optimistic.defer', { reason: 'strict-writer' })
      return strictGate.then(() => commitOptimistic(updater))
    }
    return new Promise((resolve, reject) => {
      let nextDoc
      try {
        nextDoc = typeof updater === 'function' ? updater(snapshot().doc) : updater
      } catch (error) {
        trace('optimistic.reject', { reason: String(error?.message ?? error) })
        reject(error)
        return
      }
      if (!nextDoc || typeof nextDoc !== 'object') {
        trace('optimistic.reject', { reason: 'doc-required' })
        reject(new Error('doc-required'))
        return
      }
      const coalesced = pendingDoc !== null || drainPromise !== null
      trace('optimistic.enqueue', { coalesced, revision: snapshot().revision, waiters: pendingWaiters.length + 1 })
      store.dispatch('optimistic-doc', { doc: nextDoc })
      pendingDoc = nextDoc
      pendingWaiters.push({ resolve: () => resolve(nextDoc), reject })
      trace('optimistic.dispatch', { revision: snapshot().revision, optimistic: true, coalesced })
      schedule()
    })
  }

  /** Wait until every optimistic write (including in-flight ones) settles. */
  const flush = async () => {
    while (!disposed) {
      if (strictGate !== null) {
        await strictGate
        continue
      }
      if (drainPromise !== null) {
        await drainPromise
        continue
      }
      if (pendingDoc === null) return
      schedule()
    }
  }

  /**
   * One non-optimistic commit. Flushes optimistic state first, then takes the
   * writer lock so no optimistic request can interleave with the strict write.
   * The updater is resolved against the latest doc inside the lock.
   *
   * @param {object | ((doc: object) => object)} updater
   * @returns {Promise<object>} the server-confirmed doc
   */
  const commitStrict = async (updater) => {
    await flush()
    if (disposed) throw new Error('optimistic-queue-disposed')
    const gate = deferred()
    strictGate = gate.promise
    try {
      const current = snapshot()
      const nextDoc = typeof updater === 'function' ? updater(current.doc) : updater
      const baseRevision = current.revision
      trace('queue.strict.start', { revision: baseRevision })
      const result = await commit(nextDoc, baseRevision)
      if (result?.ok === true) {
        trace('queue.strict.end', { ok: true, revision: result.revision })
        store.dispatch('doc', { doc: result.doc, revision: result.revision })
        return result.doc
      }
      if (result?.code === 'conflict' && result.doc) {
        trace('queue.strict.end', { ok: false, code: 'conflict' })
        store.dispatch('commit-conflict', { doc: result.doc, revision: result.revision })
        notify({ kind: 'error', message: t('banner.conflict') })
        return result.doc
      }
      trace('queue.strict.end', { ok: false, code: result?.code ?? null })
      store.dispatch('commit-error', { code: result?.code === 'fence-unavailable' ? 'route-unavailable' : result?.code })
      const error = new Error(result?.message ?? result?.code ?? 'commit-failed')
      error.code = result?.code
      throw error
    } finally {
      strictGate = null
      gate.resolve()
      if (!disposed && pendingDoc !== null) schedule()
    }
  }

  return {
    commitOptimistic,
    commitStrict,
    flush,
    /** Whether a write is pending/in flight (tests + shell diagnostics). */
    isPending: () => pendingDoc !== null || drainPromise !== null || strictGate !== null,
    dispose: () => {
      disposed = true
      const failure = asReported(new Error('optimistic-queue-disposed'), 'disposed')
      settle(pendingWaiters, failure)
      pendingWaiters = []
      pendingDoc = null
    },
  }
}
