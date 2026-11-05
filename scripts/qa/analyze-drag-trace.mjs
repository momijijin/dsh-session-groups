#!/usr/bin/env node
/**
 * Analyse a dsh-session-grove drag diagnostics file (0.2.5).
 *
 * Input: NDJSON written by `POST /dsh-session-grove/diagnostics` to
 * `<dshHomePath('storages')>/dsh-session-grove.diagnostics.ndjson`. Each line is
 * `{receivedAt, runId, schemaVersion, event}` (or a raw event for older builds).
 *
 * Usage:
 *   node scripts/qa/analyze-drag-trace.mjs <file> [--run <runId>] [--json]
 *                                            [--limit <timelineEntries>]
 *
 * The summary is intentionally machine-readable (`--json`) so a real desktop
 * drag can be attached to a bug report without sharing titles/transcripts: the
 * file only contains ids, group names and translated drag labels.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const SCHEMA_VERSION = 1
export const SCHEMA_KNOWN = new Set([SCHEMA_VERSION])
export const SLOW_HANDLER_MS = 50
export const SLOW_HTTP_MS = 500
export const LONG_FRAME_MS = 100
export const GAP_TRACE_MS = 100
export const FREEZE_MS = 2000
export const BURST_EVENT_COUNT = 25
export const BURST_SPAN_MS = 750

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

const timeOf = (event) => finite(event?.t) ?? finite(event?.ts) ?? 0

const round = (value, digits = 2) => {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

const targetText = (target) => {
  if (!target || typeof target !== 'object') return 'none'
  const parts = [target.kind ?? '?' ]
  if (target.sessionId) parts.push(`session=${target.sessionId}`)
  if (target.groupId) parts.push(`group=${target.groupId}`)
  if (target.targetId) parts.push(`target=${target.targetId}`)
  if (target.parentId) parts.push(`parent=${target.parentId}`)
  if (target.beforeGroupId) parts.push(`before=${target.beforeGroupId}`)
  return parts.join(':')
}

/**
 * Parse NDJSON text into normalized `{runId, schemaVersion, receivedAt, event}`
 * records. Invalid JSON lines and blank lines are counted, never thrown.
 */
export const parseTrace = (text) => {
  const records = []
  const parseErrors = []
  const lines = String(text ?? '').split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (line === '') continue
    let raw
    try {
      raw = JSON.parse(line)
    } catch (error) {
      parseErrors.push({ line: index + 1, message: String(error?.message ?? error) })
      continue
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      parseErrors.push({ line: index + 1, message: 'line is not a JSON object' })
      continue
    }
    const envelope = raw.event !== null && typeof raw.event === 'object' && !Array.isArray(raw.event) ? raw : null
    const event = envelope ? raw.event : raw
    records.push({
      runId: typeof raw.runId === 'string' ? raw.runId : typeof event.runId === 'string' ? event.runId : 'unknown',
      schemaVersion: envelope
        ? raw.schemaVersion ?? event.v ?? null
        : raw.schemaVersion ?? raw.v ?? null,
      receivedAt: typeof raw.receivedAt === 'string' ? raw.receivedAt : null,
      event,
    })
  }
  return { records, parseErrors }
}

/** Group normalized records per run and sort each run by seq/time. */
export const groupByRun = (records) => {
  const groups = new Map()
  for (const record of records) {
    if (!groups.has(record.runId)) groups.set(record.runId, [])
    groups.get(record.runId).push(record)
  }
  for (const list of groups.values()) {
    list.sort((left, right) => {
      const leftSeq = finite(left.event?.seq)
      const rightSeq = finite(right.event?.seq)
      if (leftSeq !== null && rightSeq !== null && leftSeq !== rightSeq) return leftSeq - rightSeq
      return timeOf(left.event) - timeOf(right.event)
    })
  }
  return groups
}

const bump = (object, key) => {
  object[key] = (object[key] ?? 0) + 1
}

const topEntries = (object, limit = 12) =>
  Object.entries(object)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)

const summarizeHttp = (events) => {
  const open = []
  const completed = []
  for (const event of events) {
    if (event.type === 'http.start') {
      open.push({ path: event.path ?? '?', method: event.method ?? 'GET', at: timeOf(event) })
    } else if (event.type === 'http.end') {
      const started = open.shift()
      completed.push({
        path: event.path ?? started?.path ?? '?',
        method: event.method ?? started?.method ?? 'GET',
        status: event.status ?? null,
        ok: event.ok === true,
        ms: finite(event.ms) ?? (started ? round(timeOf(event) - started.at) : null),
        error: event.error ?? null,
      })
    }
  }
  for (const pending of open) completed.push({ ...pending, status: null, ok: null, ms: null, pending: true })
  return completed
}

/**
 * Summarize one run's normalized records. Pure and JSON-serializable.
 */
export const summarizeRun = (runId, records) => {
  const events = records.map((record) => record.event)
  const schemaVersions = [...new Set(records.map((record) => record.schemaVersion).filter((version) => version !== null))]
  const countsByType = Object.create(null)
  const countsByHandler = Object.create(null)
  const native = { count: 0, capture: 0, bubble: 0, trusted: 0, synthetic: 0, byEvent: Object.create(null) }
  const targetChanges = []
  const labels = []
  const gaps = []
  const autoexpand = { schedule: 0, fire: 0, cancel: 0, timeline: [] }
  const placeholders = { insert: 0, remove: 0, timeline: [] }
  const optimistic = {
    enqueue: 0,
    coalesced: 0,
    send: 0,
    reconcile: 0,
    rollback: 0,
    strictStart: 0,
    strictEnd: 0,
    timeline: [],
  }
  const frameGaps = []
  const longTasks = []
  const slowHandlers = []
  let previous = null

  for (const event of events) {
    const type = typeof event?.type === 'string' ? event.type : 'unknown'
    bump(countsByType, type)
    if (previous !== null) {
      const gap = timeOf(event) - timeOf(previous)
      if (gap >= GAP_TRACE_MS) {
        gaps.push({
          afterSeq: previous.seq ?? null,
          beforeSeq: event.seq ?? null,
          afterType: previous.type ?? null,
          beforeType: type,
          ms: round(gap),
          at: round(timeOf(event)),
          dragActive: previous.ctx?.dragActive === true,
        })
      }
    }
    previous = event

    if (type === 'handler') {
      const name = typeof event.handler === 'string' ? event.handler : 'unknown'
      bump(countsByHandler, name)
      if (finite(event.ms) !== null && event.ms >= SLOW_HANDLER_MS) {
        slowHandlers.push({ handler: name, ms: round(event.ms), at: round(timeOf(event)) })
      }
    } else if (type.startsWith('native.')) {
      native.count += 1
      if (event.phase === 'capture') native.capture += 1
      else if (event.phase === 'bubble') native.bubble += 1
      if (event.trusted === true) native.trusted += 1
      else native.synthetic += 1
      bump(native.byEvent, event.event ?? type.slice('native.'.length))
    } else if (type === 'dropTarget.change') {
      targetChanges.push({
        seq: event.seq ?? null,
        at: round(timeOf(event)),
        ms: round(timeOf(event)),
        from: targetText(event.from),
        to: targetText(event.to),
      })
    } else if (type === 'label.change') {
      labels.push({ seq: event.seq ?? null, at: round(timeOf(event)), text: String(event.text ?? '') })
    } else if (type === 'autoexpand.schedule' || type === 'autoexpand.fire' || type === 'autoexpand.cancel') {
      const key = type.slice('autoexpand.'.length)
      autoexpand[key] = (autoexpand[key] ?? 0) + 1
      autoexpand.timeline.push({ seq: event.seq ?? null, at: round(timeOf(event)), action: key, groupId: event.groupId ?? null })
    } else if (type === 'placeholder.insert' || type === 'placeholder.remove') {
      const key = type === 'placeholder.insert' ? 'insert' : 'remove'
      placeholders[key] = (placeholders[key] ?? 0) + 1
      placeholders.timeline.push({ seq: event.seq ?? null, at: round(timeOf(event)), action: key, kind: event.kind ?? null })
    } else if (
      type === 'optimistic.enqueue' ||
      type === 'optimistic.dispatch' ||
      type === 'optimistic.reject' ||
      type === 'optimistic.defer' ||
      type === 'queue.send' ||
      type === 'queue.reconcile' ||
      type === 'queue.rollback' ||
      type === 'queue.strict.start' ||
      type === 'queue.strict.end'
    ) {
      const key =
        type === 'optimistic.enqueue'
          ? 'enqueue'
          : type === 'queue.send'
            ? 'send'
            : type === 'queue.reconcile'
              ? 'reconcile'
              : type === 'queue.rollback'
                ? 'rollback'
                : type === 'queue.strict.start'
                  ? 'strictStart'
                  : type === 'queue.strict.end'
                    ? 'strictEnd'
                    : type
      if (key in optimistic) optimistic[key] += 1
      if (type === 'optimistic.enqueue' && event.coalesced === true) optimistic.coalesced += 1
      optimistic.timeline.push({
        seq: event.seq ?? null,
        at: round(timeOf(event)),
        action: type,
        revision: event.revision ?? null,
        code: event.code ?? null,
        coalesced: event.coalesced ?? null,
      })
    } else if (type === 'perf.frame-gap') {
      frameGaps.push({ seq: event.seq ?? null, gap: round(event.gap), at: round(timeOf(event)) })
    } else if (type === 'perf.longtask') {
      longTasks.push({ seq: event.seq ?? null, duration: round(event.duration), at: round(timeOf(event)) })
    }
  }

  // Last pointer movement: the final native geometry event whose coordinates
  // differ from the previous coordinates. Drag lifecycle events (dragstart /
  // dragend) carry no useful coordinates in synthetic CDP traces and a new
  // dragstart starts a new gesture, so both are excluded. Everything after the
  // last movement up to the next dragstart is the post-pointer burst window.
  const movementTypes = new Set(['native.dragover', 'native.dragenter', 'native.dragleave', 'native.drop'])
  const movement = []
  let lastX = null
  let lastY = null
  events.forEach((event, index) => {
    if (typeof event?.type !== 'string' || !movementTypes.has(event.type)) return
    const x = finite(event.x)
    const y = finite(event.y)
    if (x === null && y === null) return
    if (x !== lastX || y !== lastY) {
      movement.push({ index, seq: event.seq ?? null, at: round(timeOf(event)), x, y, type: event.type })
      lastX = x
      lastY = y
    }
  })
  const lastMovement = movement.length > 0 ? movement[movement.length - 1] : null
  let gestureEnd = events.length
  if (lastMovement !== null) {
    for (let index = lastMovement.index + 1; index < events.length; index += 1) {
      // A burst is only meaningful inside the current gesture: stop at dragend
      // (the drop handshake) or at the next dragstart (a new gesture).
      if (events[index]?.type === 'native.dragstart' || events[index]?.type === 'native.dragend') {
        gestureEnd = index
        break
      }
    }
  }
  const afterLastMovement = lastMovement === null ? [] : events.slice(lastMovement.index + 1, gestureEnd)
  const afterTypes = Object.create(null)
  for (const event of afterLastMovement) bump(afterTypes, typeof event?.type === 'string' ? event.type : 'unknown')
  const autoexpandAfter = afterLastMovement.filter((event) => typeof event?.type === 'string' && event.type.startsWith('autoexpand.')).length
  const burstSpanMs = lastMovement === null || afterLastMovement.length === 0 ? 0 : round(timeOf(afterLastMovement[afterLastMovement.length - 1]) - timeOf(events[lastMovement.index]))
  const burst =
    afterLastMovement.length >= BURST_EVENT_COUNT || (burstSpanMs >= BURST_SPAN_MS && afterLastMovement.length >= 5)

  const httpCalls = summarizeHttp(events)
  const slowHttp = httpCalls.filter((call) => finite(call.ms) !== null && call.ms >= SLOW_HTTP_MS)
  const firstAt = events.length > 0 ? timeOf(events[0]) : null
  const lastAt = events.length > 0 ? timeOf(events[events.length - 1]) : null

  const suspectedStalls = []
  if (frameGaps.length > 0) {
    suspectedStalls.push({ kind: 'frame-gap', count: frameGaps.length, maxMs: Math.max(...frameGaps.map((item) => item.gap ?? 0)) })
  }
  if (longTasks.length > 0) {
    suspectedStalls.push({ kind: 'longtask', count: longTasks.length, maxMs: Math.max(...longTasks.map((item) => item.duration ?? 0)) })
  }
  if (slowHandlers.length > 0) {
    const worst = slowHandlers.reduce((best, item) => (item.ms > best.ms ? item : best), slowHandlers[0])
    suspectedStalls.push({ kind: 'slow-handler', handler: worst.handler, ms: worst.ms, count: slowHandlers.length })
  }
  if (slowHttp.length > 0) {
    const worst = slowHttp.reduce((best, item) => ((item.ms ?? 0) > (best.ms ?? 0) ? item : best), slowHttp[0])
    suspectedStalls.push({ kind: 'slow-http', path: worst.path, ms: worst.ms, count: slowHttp.length })
  }
  if (burst) {
    suspectedStalls.push({
      kind: 'burst-after-last-pointer-move',
      events: afterLastMovement.length,
      spanMs: burstSpanMs,
      lastMovement: lastMovement?.type ?? null,
    })
  }
  const unsettled = optimistic.send > optimistic.reconcile + optimistic.rollback
  if (unsettled) {
    suspectedStalls.push({
      kind: 'unsettled-optimistic-write',
      sends: optimistic.send,
      reconciles: optimistic.reconcile,
      rollbacks: optimistic.rollback,
    })
  }
  const accepted = countsByType['drop.accept'] ?? 0
  if (accepted > 0 && optimistic.send === 0) {
    suspectedStalls.push({ kind: 'drop-without-queue-send', accepted })
  }
  const freezeGaps = gaps.filter(
    (gap) =>
      gap.ms >= FREEZE_MS &&
      gap.dragActive === true &&
      // Gesture boundaries are not stalls: a missing/far-apart dragstart (E2E
      // helpers, pointer between gestures) would otherwise look like a freeze.
      gap.afterType !== 'native.dragstart' &&
      gap.beforeType !== 'native.dragstart' &&
      gap.afterType !== 'native.dragend' &&
      gap.beforeType !== 'native.dragend'
  )
  if (freezeGaps.length > 0) {
    suspectedStalls.push({ kind: 'event-freeze', count: freezeGaps.length, maxMs: Math.max(...freezeGaps.map((gap) => gap.ms)) })
  }

  return {
    runId,
    schemaVersions,
    schemaMismatch: schemaVersions.length > 0 && schemaVersions.some((version) => !SCHEMA_KNOWN.has(version)),
    eventCount: events.length,
    firstAt: round(firstAt),
    lastAt: round(lastAt),
    durationMs: firstAt === null || lastAt === null ? null : round(lastAt - firstAt),
    countsByType,
    countsByHandler,
    topHandlers: topEntries(countsByHandler),
    native,
    targetChanges,
    labels,
    gaps,
    autoexpand,
    placeholders,
    optimistic: { ...optimistic, http: httpCalls, unsettled },
    frameGaps,
    longTasks,
    slowHandlers,
    movement,
    lastMovement,
    burst: {
      events: afterLastMovement.length,
      spanMs: burstSpanMs,
      detected: burst,
      autoexpandAfter,
      byType: afterTypes,
    },
    suspectedStalls,
  }
}

/** Summarize the whole file: per-run summaries + parse/schema diagnostics. */
export const summarizeTrace = (text, { runId = null } = {}) => {
  const { records, parseErrors } = parseTrace(text)
  const groups = groupByRun(records)
  const runs = []
  for (const [id, list] of groups) {
    if (runId !== null && id !== runId) continue
    runs.push(summarizeRun(id, list))
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    records: records.length,
    parseErrors,
    runs,
  }
}

const shortId = (value) => (value === null || value === undefined ? '-' : String(value))

/**
 * Render one line-oriented human summary. Kept deliberately compact: the JSON
 * form has every detail, the text form is what a bug report needs.
 */
export const renderSummary = (summary) => {
  const lines = []
  lines.push(`trace: records=${summary.records} parseErrors=${summary.parseErrors.length} runs=${summary.runs.length}`)
  for (const error of summary.parseErrors.slice(0, 5)) lines.push(`  ! line ${error.line}: ${error.message}`)
  for (const run of summary.runs) {
    lines.push('')
    lines.push(`run ${run.runId} (schema ${run.schemaVersions.join(',') || '?'}${run.schemaMismatch ? ', UNKNOWN' : ''})`)
    lines.push(`  window: ${run.eventCount} events, ${shortId(run.durationMs)}ms`)
    lines.push(`  types: ${topEntries(run.countsByType, 14).map(([key, value]) => `${key}=${value}`).join(' ')}`)
    if (run.topHandlers.length > 0) {
      lines.push(`  handlers: ${run.topHandlers.map(([key, value]) => `${key}=${value}`).join(' ')}`)
    }
    lines.push(
      `  native: ${run.native.count} (capture=${run.native.capture} bubble=${run.native.bubble} trusted=${run.native.trusted} synthetic=${run.native.synthetic})`
    )
    lines.push(`  target changes (${run.targetChanges.length}):`)
    for (const change of run.targetChanges.slice(0, 12)) lines.push(`    +${change.at}ms  ${change.from} -> ${change.to}`)
    if (run.labels.length > 0) lines.push(`  labels (${run.labels.length}): ${run.labels.map((label) => label.text || '∅').join(' -> ')}`)
    if (run.gaps.length > 0) {
      lines.push(`  gaps >=100ms (${run.gaps.length}): ${run.gaps.slice(0, 8).map((gap) => `${gap.ms}ms(${gap.afterType}->${gap.beforeType})`).join(' ')}`)
    }
    lines.push(`  autoexpand: schedule=${run.autoexpand.schedule} fire=${run.autoexpand.fire} cancel=${run.autoexpand.cancel}`)
    lines.push(`  placeholder: insert=${run.placeholders.insert} remove=${run.placeholders.remove}`)
    lines.push(
      `  optimistic: enqueue=${run.optimistic.enqueue} coalesced=${run.optimistic.coalesced} send=${run.optimistic.send} reconcile=${run.optimistic.reconcile} rollback=${run.optimistic.rollback} strict=${run.optimistic.strictStart}/${run.optimistic.strictEnd} unsettled=${run.optimistic.unsettled}`
    )
    if (run.optimistic.http.length > 0) {
      lines.push(
        `  http: ${run.optimistic.http
          .slice(0, 8)
          .map((call) => `${call.method} ${call.path} ${call.status ?? 'pending'} ${call.ms ?? '?'}ms`)
          .join(' | ')}`
      )
    }
    lines.push(`  frames: gaps>=100ms=${run.frameGaps.length} longtasks=${run.longTasks.length}`)
    lines.push(
      `  burst: lastMovement=${run.lastMovement?.type ?? 'none'} eventsAfter=${run.burst.events} span=${run.burst.spanMs}ms autoexpandAfter=${run.burst.autoexpandAfter} -> ${run.burst.detected ? 'BURST' : 'ok'}`
    )
    if (run.suspectedStalls.length > 0) {
      lines.push('  suspected stalls:')
      for (const stall of run.suspectedStalls) lines.push(`    - ${JSON.stringify(stall)}`)
    } else {
      lines.push('  suspected stalls: none')
    }
  }
  return lines.join('\n')
}

export const main = (argv = process.argv.slice(2)) => {
  const args = { file: null, runId: null, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') args.json = true
    else if (arg === '--run') args.runId = argv[++index] ?? null
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/qa/analyze-drag-trace.mjs <file> [--run <runId>] [--json]')
      return 0
    } else if (!arg.startsWith('--') && args.file === null) args.file = arg
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (args.file === null) {
    console.error('usage: node scripts/qa/analyze-drag-trace.mjs <file> [--run <runId>] [--json]')
    return 2
  }
  let text
  try {
    text = readFileSync(args.file, 'utf8')
  } catch (error) {
    console.error(`cannot read ${args.file}: ${error.message}`)
    return 2
  }
  const summary = summarizeTrace(text, { runId: args.runId })
  console.log(args.json ? JSON.stringify(summary, null, 2) : renderSummary(summary))
  return 0
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(error?.stack ?? error)
    process.exitCode = 2
  }
}
