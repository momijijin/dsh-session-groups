/**
 * Drag diagnostics (0.2.5).
 *
 * One module owns the whole client-side trace so a real desktop drag can be
 * analysed from a file afterwards instead of inferred from a screenshot:
 *
 * - a bounded ring buffer (in-page HUD / snapshot) plus a bounded send queue;
 * - document-level `dragstart/dragenter/dragover/dragleave/drop/dragend`
 *   listeners in capture **and** bubble phase (target tag/testid/ids, pointer
 *   coordinates, `defaultPrevented` before/after, trusted flag);
 * - plugin trace points (`handler`, `dropTarget.change`, placeholder/label,
 *   auto-expand, optimistic queue/HTTP phases, drop result) fed by components;
 * - timing: per-handler ms, rAF frame gaps, `longtask` entries, React render
 *   counters, current revision/optimistic flag, tree counts, viewport/sidebar
 *   width, build version, mode and theme;
 * - batching (20 events or 500 ms) flushed to
 *   `POST /dsh-session-groups/diagnostics`, which appends NDJSON under
 *   `dshHomePath('storages')`; `sendBeacon` on dragend/visibility hidden;
 * - a fixed, pointer-events:none HUD updated at <=4 Hz (never per event, never
 *   through React).
 *
 * Diagnostics are **enabled by default** in 0.2.5 and can be disabled without a
 * rebuild via `localStorage['dsh-session-groups.diagnostics'] = '0'`.
 *
 * Privacy: no session titles or transcript text are ever traced. IDs, test ids,
 * group names and translated drag labels are allowed (local file only).
 */
import { PLUGIN_VERSION } from '../shared/constants.js'

/** localStorage opt-out key (read once per page load). */
export const DIAGNOSTICS_STORAGE_KEY = 'dsh-session-groups.diagnostics'
/** Wire schema version; bump when event field names change. */
export const DIAGNOSTICS_SCHEMA_VERSION = 1
/** Host route that appends the NDJSON trace. */
export const DIAGNOSTICS_PATH = 'dsh-session-groups/diagnostics'
/** Batch trigger: pending events before an immediate flush. */
export const DIAGNOSTICS_BATCH_SIZE = 20
/** Batch trigger: maximum delay between flushes. */
export const DIAGNOSTICS_FLUSH_MS = 500
/** Ring buffer size (in-page analysis + HUD). */
export const DIAGNOSTICS_RING_SIZE = 4000
/** Unsent queue ceiling; older events are dropped (and counted) past this. */
export const DIAGNOSTICS_MAX_QUEUE = 800
/** Maximum events per HTTP batch (host caps at 500). */
export const DIAGNOSTICS_MAX_BATCH_EVENTS = 120
/** Beacon chunk ceiling (browser beacons are capped around 64 KiB). */
export const DIAGNOSTICS_BEACON_CHUNK_BYTES = 48 * 1024
/** HUD refresh interval: 4 Hz, so drag events never trigger React renders. */
export const DIAGNOSTICS_HUD_INTERVAL_MS = 250
/** HUD test id (E2E / manual verification). */
export const DIAGNOSTICS_HUD_TESTID = 'session-groups-diagnostics-hud'
/** Native drag event types traced at document level. */
export const NATIVE_DRAG_TYPES = Object.freeze(['dragstart', 'dragenter', 'dragover', 'dragleave', 'drop', 'dragend'])
/** Frame gaps at or above this are traced as suspected stalls. */
export const FRAME_GAP_TRACE_MS = 100

const clampText = (value, max = 120) => {
  const text = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

const finiteNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

const defaultNow = () =>
  typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now()

const defaultRandom = () => Math.random().toString(36).slice(2, 8)

const defaultRunId = (random) => `dsg-${Date.now().toString(36)}-${random()}`

/** Whether diagnostics are enabled for this page load (default: no). */
export const diagnosticsEnabled = (storage = null) => {
  try {
    if (globalThis.__DSG_DIAGNOSTICS__ === false) return false
    if (globalThis.__DSG_DIAGNOSTICS__ === true) return true
  } catch {
    /* hostile global object */
  }
  try {
    const target = storage ?? globalThis.localStorage
    if (target && typeof target.getItem === 'function') {
      const value = target.getItem(DIAGNOSTICS_STORAGE_KEY)
      return value === '1' || value === 'true'
    }
  } catch {
    /* blocked storage: default stays off */
  }
  return false
}

/** Classify a DOM event target into the stable trace vocabulary. */
export const describeEventTarget = (event) => {
  const raw = event?.target ?? null
  const element = raw && raw.nodeType === 1 ? raw : raw?.parentElement ?? null
  const attr = (name) => {
    try {
      const node = typeof element?.closest === 'function' ? element.closest(`[${name}]`) : null
      const value = node?.getAttribute?.(name)
      return typeof value === 'string' && value !== '' ? value : null
    } catch {
      return null
    }
  }
  // 0.2.18: no getBoundingClientRect here. The native dragover path runs at up
  // to 60 Hz (twice per event); forcing layout in the tracer was the dominant
  // diagnostic cost. Pointer coordinates plus the stable testid/ids are enough.
  return {
    tag: typeof element?.tagName === 'string' ? element.tagName.toLowerCase() : null,
    testid: attr('data-testid'),
    sessionId: attr('data-session-id'),
    groupId: attr('data-group-id'),
    ungrouped: attr('data-ungrouped') === 'true' ? true : null,
  }
}

/** Compact stable-target descriptor for dropTarget.change events. */
export const describeDropTarget = (target) => {
  if (!target || typeof target !== 'object') return null
  const compact = {
    kind: target.kind ?? null,
    sessionId: target.sessionId ?? null,
    groupId: target.groupId ?? null,
    targetId: target.targetId ?? null,
    parentId: target.parentId ?? null,
    beforeGroupId: target.beforeGroupId ?? null,
  }
  return compact
}

const targetKey = (target) => {
  if (!target) return 'none'
  const d = describeDropTarget(target)
  return [d.kind, d.sessionId, d.groupId, d.targetId, d.parentId, d.beforeGroupId].map((v) => v ?? '').join('|')
}

/** Drop-target kinds that render an insertion placeholder in the tree. */
const PLACEHOLDER_KINDS = new Set([
  'session-before',
  'session-after',
  'group-before',
  'group-after',
  'group-child',
  'group-append',
  'group-head',
  'group-forbidden',
  'group-root-end',
  'ungrouped',
])

const hasPlaceholder = (target) => target !== null && target !== undefined && PLACEHOLDER_KINDS.has(target.kind)

const readTheme = (documentRef) => {
  try {
    const body = documentRef?.body
    if (body && typeof body.hasAttribute === 'function' && body.hasAttribute('data-ds-dark-theme')) return 'dark'
    const root = documentRef?.documentElement
    if (root && typeof root.hasAttribute === 'function') {
      if (root.hasAttribute('data-ds-dark-theme')) return 'dark'
      const attr = root.getAttribute('data-theme') ?? root.getAttribute('data-color-scheme')
      if (typeof attr === 'string' && attr.length > 0) return attr
    }
  } catch {
    /* detached document */
  }
  return 'light'
}

/**
 * Create one diagnostics instance (one per page / plugin mount).
 *
 * Every clock, DOM, transport and timer dependency is injectable so the ring
 * buffer, batching and flush semantics are unit-tested in plain Node.
 */
export const createDiagnostics = (options = {}) => {
  const storage = options.storage ?? null
  const enabled = options.enabled ?? diagnosticsEnabled(storage)
  const now = typeof options.now === 'function' ? options.now : defaultNow
  const documentRef = Object.hasOwn(options, 'documentRef') ? options.documentRef : globalThis.document ?? null
  const windowRef = Object.hasOwn(options, 'windowRef') ? options.windowRef : globalThis
  const fetchImpl = Object.hasOwn(options, 'fetchImpl') ? options.fetchImpl : globalThis.fetch
  const beaconImpl =
    options.beacon !== undefined
      ? options.beacon
      : typeof globalThis.navigator?.sendBeacon === 'function'
        ? globalThis.navigator.sendBeacon.bind(globalThis.navigator)
        : null
  const endpoint = options.endpoint ?? DIAGNOSTICS_PATH
  const batchSize = Number.isInteger(options.batchSize) && options.batchSize > 0 ? options.batchSize : DIAGNOSTICS_BATCH_SIZE
  const flushMs =
    Number.isInteger(options.flushIntervalMs) && options.flushIntervalMs >= 0
      ? options.flushIntervalMs
      : DIAGNOSTICS_FLUSH_MS
  const ringSize = Number.isInteger(options.ringSize) && options.ringSize > 0 ? options.ringSize : DIAGNOSTICS_RING_SIZE
  const maxQueue =
    Number.isInteger(options.maxQueue) && options.maxQueue > 0 ? options.maxQueue : DIAGNOSTICS_MAX_QUEUE
  const maxBatchEvents =
    Number.isInteger(options.maxBatchEvents) && options.maxBatchEvents > 0
      ? options.maxBatchEvents
      : DIAGNOSTICS_MAX_BATCH_EVENTS
  const hudEnabled = options.hud !== false
  const nativeEnabled = options.native !== false
  const longTaskEnabled = options.longTasks !== false
  const frameEnabled = options.frames !== false
  const random = typeof options.random === 'function' ? options.random : defaultRandom
  const setTimeoutImpl = typeof options.setTimeoutImpl === 'function' ? options.setTimeoutImpl : globalThis.setTimeout
  const clearTimeoutImpl =
    typeof options.clearTimeoutImpl === 'function' ? options.clearTimeoutImpl : globalThis.clearTimeout
  const setIntervalImpl = typeof options.setIntervalImpl === 'function' ? options.setIntervalImpl : globalThis.setInterval
  const clearIntervalImpl =
    typeof options.clearIntervalImpl === 'function' ? options.clearIntervalImpl : globalThis.clearInterval
  const runId = typeof options.runId === 'string' && options.runId.length > 0 ? options.runId : defaultRunId(random)

  /** No-op surface when diagnostics are disabled (single cached boolean). */
  if (!enabled) {
    return {
      enabled: false,
      runId,
      schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
      trace: () => null,
      setContext: () => {},
      render: () => {},
      label: () => {},
      handler: () => {},
      dragStart: () => {},
      dragEnd: () => {},
      targetChange: () => {},
      dropState: () => {},
      startFrames: () => {},
      stopFrames: () => {},
      flush: () => Promise.resolve(),
      snapshot: () => ({ enabled: false, runId, events: [], stats: {} }),
      dispose: () => {},
    }
  }

  const ring = []
  const queue = []
  const renderCounts = Object.create(null)
  const context = {
    build: PLUGIN_VERSION,
    runtime: 'web',
    mode: 'unknown',
    theme: readTheme(documentRef),
    revision: 0,
    optimistic: false,
    groups: 0,
    ungrouped: 0,
    visibleSessions: 0,
    viewport: finiteNumber(windowRef?.innerWidth) ?? 0,
    sidebarWidth: null,
  }
  const stats = {
    events: 0,
    nativeDragOver: 0,
    nativeDragEvents: 0,
    targetChanges: 0,
    placeholderInserts: 0,
    placeholderRemoves: 0,
    renders: 0,
    lastHandlerMs: 0,
    lastHandler: null,
    lastFrameGap: 0,
    lastLabel: '',
    dropState: 'idle',
    dropped: 0,
    flushFailures: 0,
    flushes: 0,
    dragActive: false,
    dragKind: null,
    lastTargetKind: null,
  }
  let seq = 0
  let timer = null
  let retryTimer = null
  let flushTail = Promise.resolve()
  let failuresSinceSuccess = 0
  let hudElement = null
  let hudTimer = null
  let frameActive = false
  let frameRequest = null
  let lastFrameAt = 0
  let longTaskObserver = null
  let disposed = false
  let warnedFlushFailure = false

  const resolvesEndpoint = () => {
    try {
      return new URL(endpoint, documentRef?.baseURI ?? 'http://localhost/').toString()
    } catch {
      return endpoint
    }
  }

  const makeEvent = (type, detail) => {
    const event = {
      v: DIAGNOSTICS_SCHEMA_VERSION,
      runId,
      seq: (seq += 1),
      t: Math.round(now() * 100) / 100,
      ts: Date.now(),
      type,
      ctx: {
        ...context,
        theme: readTheme(documentRef),
        renders: { ...renderCounts },
        dragActive: stats.dragActive,
      },
      ...(detail ?? {}),
    }
    return event
  }

  const scheduleFlush = () => {
    if (disposed) return
    if (queue.length >= batchSize) {
      if (timer !== null) {
        clearTimeoutImpl?.(timer)
        timer = null
      }
      void flush()
      return
    }
    if (timer === null && typeof setTimeoutImpl === 'function') {
      timer = setTimeoutImpl(() => {
        timer = null
        void flush()
      }, flushMs)
      // Never keep a Node test process alive because of the batch timer.
      timer?.unref?.()
    }
  }

  const trim = (list, limit) => {
    if (list.length <= limit) return 0
    const drop = list.length - limit
    list.splice(0, drop)
    return drop
  }

  /**
   * Ring trimming is batched (512-event slack) so the 60 Hz dragover path does
   * not pay an O(ring) splice on every event; the logical bound is ringSize and
   * snapshots still hold at most ringSize events.
   */
  const RING_SLACK = 512
  const pushRing = (event) => {
    ring.push(event)
    if (ring.length > ringSize + RING_SLACK) ring.splice(0, ring.length - ringSize)
  }

  const trace = (type, detail = null) => {
    if (disposed || typeof type !== 'string' || type.length === 0) return null
    const event = makeEvent(type, detail)
    pushRing(event)
    queue.push(event)
    stats.dropped += trim(queue, maxQueue)
    stats.events += 1
    if (type === 'native.dragover' && event.phase === 'capture') stats.nativeDragOver += 1
    if (type === 'dropTarget.change') stats.targetChanges += 1
    if (type === 'placeholder.insert') stats.placeholderInserts += 1
    if (type === 'placeholder.remove') stats.placeholderRemoves += 1
    if (type === 'handler' && typeof event.ms === 'number') {
      stats.lastHandlerMs = event.ms
      stats.lastHandler = event.handler ?? null
    }
    scheduleFlush()
    return event
  }

  const setContext = (patch) => {
    if (disposed || !patch || typeof patch !== 'object') return
    let changed = false
    for (const [key, value] of Object.entries(patch)) {
      if (context[key] !== value) {
        context[key] = value
        changed = true
      }
    }
    if (changed) context.theme = readTheme(documentRef)
  }

  const render = (name) => {
    if (disposed || typeof name !== 'string') return
    renderCounts[name] = (renderCounts[name] ?? 0) + 1
    stats.renders += 1
  }

  const label = (text) => {
    const next = clampText(text)
    if (disposed || next === stats.lastLabel) return
    stats.lastLabel = next
    trace('label.change', { text: next })
  }

  const handler = (name, durationMs, event = null) => {
    if (disposed) return
    const ms = typeof durationMs === 'number' && Number.isFinite(durationMs) ? Math.round(durationMs * 100) / 100 : 0
    trace('handler', {
      handler: name,
      ms,
      x: finiteNumber(event?.clientX),
      y: finiteNumber(event?.clientY),
      target: event ? describeEventTarget(event) : null,
      prevented: event ? event.defaultPrevented === true : null,
      dragKind: stats.dragKind,
    })
  }

  const dragStart = (kind, detail = null) => {
    if (disposed) return
    stats.dragKind = typeof kind === 'string' ? kind : null
    stats.dragActive = true
    stats.dropState = 'dragging'
    trace('drag.start', { kind: stats.dragKind, ...(detail ?? {}) })
    startFrames()
  }

  const dragEnd = (detail = null) => {
    if (disposed) return
    stats.dragKind = null
    stats.dragActive = false
    stats.dropState = stats.dropState === 'dragging' ? 'idle' : stats.dropState
    trace('drag.end', { ...(detail ?? {}) })
    stopFrames()
    void flush({ beacon: true })
  }

  const targetChange = (previous, next) => {
    if (disposed || targetKey(previous) === targetKey(next)) return false
    const from = describeDropTarget(previous)
    const to = describeDropTarget(next)
    trace('dropTarget.change', { from: from ? { ...from } : null, to: to ? { ...to } : null })
    stats.lastTargetKind = to?.kind ?? null
    const hadPlaceholder = hasPlaceholder(previous)
    const has = hasPlaceholder(next)
    // A placeholder is a concrete DOM insertion: moving from one placeholder
    // target to another removes the old gap and inserts a new one.
    if (hadPlaceholder) trace('placeholder.remove', { kind: from?.kind ?? null })
    if (has) trace('placeholder.insert', { kind: to?.kind ?? null })
    return true
  }

  const dropState = (state, detail = null) => {
    if (disposed) return
    stats.dropState = typeof state === 'string' && state.length > 0 ? state : 'idle'
    if (detail) trace('drop.state', { state: stats.dropState, ...detail })
  }

  const startFrames = () => {
    if (disposed || !frameEnabled || frameActive) return
    const raf = windowRef?.requestAnimationFrame
    if (typeof raf !== 'function') return
    frameActive = true
    lastFrameAt = 0
    const tick = (timestamp) => {
      if (!frameActive) return
      const at = typeof timestamp === 'number' ? timestamp : now()
      if (lastFrameAt !== 0) {
        const gap = Math.round((at - lastFrameAt) * 100) / 100
        stats.lastFrameGap = gap
        if (gap >= FRAME_GAP_TRACE_MS) trace('perf.frame-gap', { gap })
      }
      lastFrameAt = at
      frameRequest = raf(tick)
    }
    frameRequest = raf(tick)
  }

  const stopFrames = () => {
    if (!frameActive) return
    frameActive = false
    try {
      windowRef?.cancelAnimationFrame?.(frameRequest)
    } catch {
      /* detached window */
    }
    frameRequest = null
  }

  const sendBatch = async (events, { beacon = false, keepalive = false } = {}) => {
    const payload = JSON.stringify({ runId, schemaVersion: DIAGNOSTICS_SCHEMA_VERSION, events })
    const url = resolvesEndpoint()
    if (beacon && typeof beaconImpl === 'function') {
      try {
        const body = new Blob([payload], { type: 'application/json' })
        if (beaconImpl(url, body) === true) return true
      } catch {
        /* fall through to fetch */
      }
    }
    if (typeof fetchImpl !== 'function') return false
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        credentials: 'same-origin',
        keepalive,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: payload,
      })
      return response?.ok === true
    } catch {
      return false
    }
  }

  const flushBatch = async ({ beacon = false, keepalive = false } = {}) => {
    if (disposed) return
    if (timer !== null) {
      clearTimeoutImpl?.(timer)
      timer = null
    }
    while (queue.length > 0) {
      let batch
      if (beacon) {
        // Chunk by serialized size so one beacon cannot exceed the browser cap.
        batch = []
        let size = 0
        while (queue.length > 0) {
          const candidate = queue[0]
          const candidateSize = JSON.stringify(candidate).length + 1
          if (batch.length > 0 && size + candidateSize > DIAGNOSTICS_BEACON_CHUNK_BYTES) break
          batch.push(queue.shift())
          size += candidateSize
        }
      } else {
        batch = queue.splice(0, maxBatchEvents)
      }
      const ok = await sendBatch(batch, { beacon, keepalive })
      stats.flushes += 1
      if (ok) {
        failuresSinceSuccess = 0
        warnedFlushFailure = false
        continue
      }
      stats.flushFailures += 1
      failuresSinceSuccess += 1
      if (!warnedFlushFailure) {
        warnedFlushFailure = true
        try {
          globalThis.console?.warn?.('[dsh-session-groups] diagnostics flush failed; trace stays in the ring buffer')
        } catch {
          /* console unavailable */
        }
      }
      if (failuresSinceSuccess <= 2 && queue.length + batch.length <= maxQueue) {
        queue.unshift(...batch)
        if (retryTimer === null && typeof setTimeoutImpl === 'function') {
          retryTimer = setTimeoutImpl(() => {
            retryTimer = null
            void flush()
          }, 1000)
          retryTimer?.unref?.()
        }
      } else {
        stats.dropped += batch.length
      }
      break
    }
  }

  const flush = (flushOptions = {}) => {
    if (disposed) return Promise.resolve()
    flushTail = flushTail.then(() => flushBatch(flushOptions)).catch(() => {})
    return flushTail
  }

  // --- HUD (DOM only; never React) -----------------------------------------
  const hudText = () => {
    const state = stats.dropState === 'idle' && context.optimistic ? 'optimistic' : stats.dropState
    return [
      `dsg ${PLUGIN_VERSION} ${runId}`,
      `drag n=${stats.nativeDragOver} chg=${stats.targetChanges} rend=${stats.renders}`,
      `ms=${stats.lastHandlerMs} gap=${stats.lastFrameGap} lab=${stats.lastLabel || '-'}`,
      `drop=${state} opt=${context.optimistic ? 1 : 0} rev=${context.revision} q=${queue.length}`,
    ].join('\n')
  }

  const updateHud = () => {
    if (hudElement === null) return
    try {
      hudElement.textContent = hudText()
    } catch {
      /* detached HUD */
    }
  }

  const mountHud = () => {
    if (!hudEnabled || typeof documentRef?.createElement !== 'function' || !documentRef?.body) return
    try {
      const element = documentRef.createElement('div')
      element.className = 'dsg-diag-hud'
      element.dataset.testid = DIAGNOSTICS_HUD_TESTID
      element.setAttribute('data-testid', DIAGNOSTICS_HUD_TESTID)
      element.setAttribute('aria-hidden', 'true')
      element.setAttribute('data-run-id', runId)
      element.setAttribute('data-schema-version', String(DIAGNOSTICS_SCHEMA_VERSION))
      element.textContent = hudText()
      documentRef.body.appendChild(element)
      hudElement = element
      if (typeof setIntervalImpl === 'function') {
        hudTimer = setIntervalImpl(updateHud, DIAGNOSTICS_HUD_INTERVAL_MS)
        hudTimer?.unref?.()
      }
    } catch {
      hudElement = null
    }
  }

  // --- native document listeners -------------------------------------------
  const nativeHandlers = []
  const installNative = () => {
    if (!nativeEnabled || typeof documentRef?.addEventListener !== 'function') return
    for (const type of NATIVE_DRAG_TYPES) {
      const handlerFor = (phase) => (event) => {
        if (disposed) return
        const detail = {
          event: type,
          phase,
          target: describeEventTarget(event),
          x: finiteNumber(event?.clientX),
          y: finiteNumber(event?.clientY),
          prevented: event?.defaultPrevented === true,
          trusted: event?.isTrusted === true,
        }
        trace(`native.${type}`, detail)
        stats.nativeDragEvents += 1
        if (type === 'dragstart' && phase === 'capture') {
          stats.dragActive = true
          stats.dropState = 'dragging'
          startFrames()
        }
        if (type === 'dragend' && phase === 'capture') {
          stats.dragActive = false
          stats.dragKind = null
          stopFrames()
          // The gesture is over: persist the tail without waiting for the timer.
          void flush({ beacon: true })
        }
      }
      const capture = handlerFor('capture')
      try {
        documentRef.addEventListener(type, capture, true)
        nativeHandlers.push([type, capture, true])
        // 0.2.18: capture is enough for the pre-dispatch view. Bubble is only
        // needed to observe post-handler defaultPrevented on the terminal events,
        // cutting the per-dragover listener/trace work roughly in half.
        if (type === 'drop' || type === 'dragend') {
          const bubble = handlerFor('bubble')
          documentRef.addEventListener(type, bubble, false)
          nativeHandlers.push([type, bubble, false])
        }
      } catch {
        /* detached document */
      }
    }
    const onHidden = () => {
      try {
        if (documentRef?.visibilityState === 'hidden') void flush({ beacon: true })
      } catch {
        /* ignore */
      }
    }
    const onPageHide = () => void flush({ beacon: true })
    documentRef.addEventListener('visibilitychange', onHidden)
    documentRef.addEventListener('pagehide', onPageHide)
    nativeHandlers.push(['visibilitychange', onHidden, false], ['pagehide', onPageHide, false])
  }

  const installLongTasks = () => {
    if (!longTaskEnabled) return
    const Observer = options.PerformanceObserver ?? globalThis.PerformanceObserver
    if (typeof Observer !== 'function') return
    try {
      longTaskObserver = new Observer((list) => {
        for (const entry of list.getEntries()) {
          trace('perf.longtask', {
            duration: Math.round((entry.duration ?? 0) * 100) / 100,
            start: Math.round((entry.startTime ?? 0) * 100) / 100,
            name: entry.name ?? 'longtask',
          })
        }
      })
      longTaskObserver.observe({ entryTypes: ['longtask'] })
    } catch {
      longTaskObserver = null
    }
  }

  const snapshot = () => ({
    enabled: true,
    runId,
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    stats: { ...stats, renders: { ...renderCounts } },
    context: { ...context },
    events: ring.slice(-ringSize),
    pending: queue.length,
  })

  const dispose = () => {
    if (disposed) return
    disposed = true
    stopFrames()
    if (timer !== null) {
      clearTimeoutImpl?.(timer)
      timer = null
    }
    if (retryTimer !== null) {
      clearTimeoutImpl?.(retryTimer)
      retryTimer = null
    }
    if (hudTimer !== null) {
      clearIntervalImpl?.(hudTimer)
      hudTimer = null
    }
    try {
      hudElement?.remove?.()
    } catch {
      /* already detached */
    }
    hudElement = null
    for (const [type, listener, capture] of nativeHandlers.splice(0)) {
      try {
        documentRef?.removeEventListener?.(type, listener, capture)
      } catch {
        /* ignore */
      }
    }
    try {
      longTaskObserver?.disconnect?.()
    } catch {
      /* ignore */
    }
    longTaskObserver = null
  }

  mountHud()
  installNative()
  installLongTasks()
  trace('run.start', {
    build: PLUGIN_VERSION,
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    userAgent: clampText(globalThis.navigator?.userAgent ?? '', 160),
  })

  return {
    enabled: true,
    runId,
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    trace,
    setContext,
    render,
    label,
    handler,
    dragStart,
    dragEnd,
    targetChange,
    dropState,
    startFrames,
    stopFrames,
    flush,
    snapshot,
    dispose,
  }
}

// ---------------------------------------------------------------------------
// Page singleton: components import the helpers and stay dependency-free.
// ---------------------------------------------------------------------------
let current = null

/** Create (or replace) the page diagnostics instance. */
export const initDiagnostics = (options = {}) => {
  if (current !== null) current.dispose()
  current = createDiagnostics(options)
  return current
}

/** The live instance (null before the plugin mounts / in unit tests). */
export const getDiagnostics = () => current

/** Cached boolean check for hot paths. */
export const diagEnabled = () => current !== null && current.enabled === true

/** Trace one plugin event (no-op when diagnostics are off). */
export const diagTrace = (type, detail) => current?.trace(type, detail) ?? null

/** Update run context (revision/optimistic/tree counts/viewport/sidebar/...). */
export const diagContext = (patch) => current?.setContext(patch)

/** Count one React render for a component name. */
export const diagRender = (name) => current?.render(name)

/** Record one floating-label text change. */
export const diagLabel = (text) => current?.label(text)

/** Record one plugin drag handler with its duration. */
export const diagHandler = (name, durationMs, event) => current?.handler(name, durationMs, event)

/** Record a plugin session/group drag start (kind + safe ids). */
export const diagDragStart = (kind, detail) => current?.dragStart(kind, detail)

/** Record a plugin drag end (handler-level; native dragend is also traced). */
export const diagDragEnd = (detail) => current?.dragEnd(detail)

/** Record one drop-target transition (plus placeholder insert/remove). */
export const diagTargetChange = (previous, next) => current?.targetChange(previous, next) ?? false

/** Record the current drop state for the HUD. */
export const diagDropState = (state, detail) => current?.dropState(state, detail)

/** Flush pending events now (beacon on unload/dragend). */
export const diagFlush = (options) => current?.flush(options) ?? Promise.resolve()

/** Test seam: dispose and forget the page singleton. */
export const resetDiagnosticsForTests = () => {
  current?.dispose()
  current = null
}

/** Re-export the target key helper for tests. */
export const dropTargetKey = targetKey
