/**
 * Opt-in performance instrumentation (0.2.2 drag/commit latency investigation).
 *
 * Disabled by default: when disabled every helper returns after one cached
 * boolean check, so the shipped view pays no measurable cost. Enable it before
 * the plugin mounts with either
 *
 *   globalThis.__DSG_PERF__ = true
 *   localStorage['dsh-session-groups.perf'] = '1'
 *
 * and read results through `globalThis.__dsgPerfApi.snapshot()`. The probe
 * runner (`scripts/qa/probe-drag-perf.mjs`) toggles the localStorage flag and
 * reloads the page so the module caches it at boot.
 *
 * The data is deliberately aggregate: per-event marks are capped, handler
 * durations keep a bounded sample, and counters are plain objects so the
 * snapshot stays JSON-serializable across the CDP bridge.
 */

/** localStorage opt-in key (read once per page load). */
export const PERF_STORAGE_KEY = 'dsh-session-groups.perf'
const MAX_MARKS = 4000
const MAX_SAMPLES = 400
const SAMPLE_NAMES = ['dragOverMs', 'dropTargetUpdateMs', 'floatingLabelMs', 'dropHandlerMs']

/** Monotonic clock (falls back to Date.now outside a browser). */
export const perfNow = () =>
  typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now()

const createState = () => ({
  startedAt: perfNow(),
  counters: Object.create(null),
  renders: Object.create(null),
  marks: [],
  samples: Object.fromEntries(SAMPLE_NAMES.map((name) => [name, []])),
  dragOver: { events: 0, totalMs: 0, maxMs: 0, invalid: 0, byHandler: Object.create(null) },
  dropTarget: { calls: 0, changes: 0 },
})

let cachedEnabled = null
let state = createState()

const readFlag = () => {
  try {
    if (globalThis.__DSG_PERF__ === true) return true
  } catch {
    /* hostile global object */
  }
  try {
    return globalThis.localStorage?.getItem?.(PERF_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** Whether instrumentation is active for this page load. */
export const perfEnabled = () => {
  if (cachedEnabled === null) cachedEnabled = readFlag()
  return cachedEnabled
}

/** Increment one named counter (no-op when disabled). */
export const perfCount = (name, by = 1) => {
  if (!perfEnabled()) return
  state.counters[name] = (state.counters[name] ?? 0) + by
}

/** Increment one component render counter (no-op when disabled). */
export const perfRender = (name) => {
  if (!perfEnabled()) return
  state.renders[name] = (state.renders[name] ?? 0) + 1
}

/** Push one bounded numeric sample (no-op when disabled). */
export const perfSample = (name, ms) => {
  if (!perfEnabled() || !Number.isFinite(ms)) return
  const list = state.samples[name]
  if (!Array.isArray(list)) return
  if (list.length >= MAX_SAMPLES) list.shift()
  list.push(Math.round(ms * 100) / 100)
}

/** Record one timestamped mark; `detail` must stay JSON-serializable. */
export const perfMark = (name, detail = null) => {
  if (!perfEnabled()) return
  if (state.marks.length >= MAX_MARKS) state.marks.shift()
  state.marks.push({ t: Math.round(perfNow() * 100) / 100, name, detail })
}

/** Aggregate one dragover handler call. */
export const perfDragOver = (handler, durationMs, { invalid = false } = {}) => {
  if (!perfEnabled()) return
  const dragOver = state.dragOver
  dragOver.events += 1
  dragOver.totalMs += durationMs
  if (durationMs > dragOver.maxMs) dragOver.maxMs = durationMs
  if (invalid) dragOver.invalid += 1
  dragOver.byHandler[handler] = (dragOver.byHandler[handler] ?? 0) + 1
  perfSample('dragOverMs', durationMs)
}

/**
 * Aggregate one drop-target state attempt. `changed` is false when the helper
 * skipped React because the target was already the current one.
 */
export const perfDropTarget = (changed, durationMs = 0) => {
  if (!perfEnabled()) return
  state.dropTarget.calls += 1
  if (changed) state.dropTarget.changes += 1
  perfSample('dropTargetUpdateMs', durationMs)
}

const percentile = (sorted, ratio) => {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)))
  return sorted[index]
}

const summarize = (values) => {
  if (!Array.isArray(values) || values.length === 0) return { count: 0, min: 0, avg: 0, p50: 0, p95: 0, max: 0 }
  const sorted = [...values].sort((left, right) => left - right)
  const total = sorted.reduce((sum, value) => sum + value, 0)
  return {
    count: sorted.length,
    min: sorted[0],
    avg: Math.round((total / sorted.length) * 100) / 100,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
  }
}

/** Read the collected probe data (never throws). */
export const perfSnapshot = () => {
  const samples = Object.fromEntries(Object.entries(state.samples).map(([name, values]) => [name, summarize(values)]))
  return {
    enabled: perfEnabled(),
    startedAt: state.startedAt,
    capturedAt: perfNow(),
    counters: { ...state.counters },
    renders: { ...state.renders },
    dragOver: {
      ...state.dragOver,
      byHandler: { ...state.dragOver.byHandler },
      avgMs: state.dragOver.events > 0 ? Math.round((state.dragOver.totalMs / state.dragOver.events) * 100) / 100 : 0,
    },
    dropTarget: { ...state.dropTarget },
    samples,
    marks: [...state.marks],
  }
}

/** Drop all collected data and re-read the opt-in flag. */
export const perfReset = () => {
  state = createState()
  cachedEnabled = null
  return perfSnapshot()
}

/** Expose the probe API once per page (idempotent). */
export const installPerfApi = () => {
  try {
    globalThis.__dsgPerfApi = { snapshot: perfSnapshot, reset: perfReset, enabled: perfEnabled }
  } catch {
    /* non-browser environment */
  }
}

installPerfApi()
