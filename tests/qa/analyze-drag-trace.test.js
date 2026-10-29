// tests/qa/analyze-drag-trace.test.js
//
// 0.2.5 trace analyser: NDJSON envelope parsing, per-run counts, target/label
// timelines, gaps, native vs synthetic, autoexpand, placeholder mutations,
// optimistic queue/HTTP phases, burst detection after the last pointer movement
// and suspected stalls.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseTrace,
  groupByRun,
  summarizeRun,
  summarizeTrace,
  renderSummary,
} from '../../scripts/qa/analyze-drag-trace.mjs'

const envelope = (runId, schemaVersion, event) => JSON.stringify({ receivedAt: '2026-10-29T05:00:00.000Z', runId, schemaVersion, event })

const event = (seq, t, type, detail = {}) => ({ v: 1, runId: 'run-a', seq, t, ts: 1_000 + t, type, ctx: {}, ...detail })

const sampleLines = () => {
  const events = [
    event(1, 0, 'run.start', { build: '0.2.5' }),
    event(2, 10, 'native.dragstart', { phase: 'capture', event: 'dragstart', x: null, y: null }),
    event(3, 20, 'native.dragover', { phase: 'capture', event: 'dragover', x: 10, y: 10, trusted: false }),
    event(4, 30, 'native.dragover', { phase: 'capture', event: 'dragover', x: 10, y: 40, trusted: false }),
    event(5, 40, 'handler', { handler: 'onDragOverSession', ms: 60, x: 10, y: 40 }),
    event(6, 45, 'dropTarget.change', { from: null, to: { kind: 'session-before', sessionId: 's-1' } }),
    event(7, 46, 'placeholder.insert', { kind: 'session-before' }),
    event(8, 47, 'label.change', { text: '放入『A』' }),
    event(9, 60, 'autoexpand.schedule', { groupId: 'g-1' }),
    event(10, 570, 'autoexpand.fire', { groupId: 'g-1' }),
    event(11, 600, 'drop.accept', { kind: 'session-before' }),
    event(12, 601, 'optimistic.enqueue', { coalesced: false, revision: 3 }),
    event(13, 602, 'optimistic.dispatch', { optimistic: true }),
    event(14, 603, 'queue.send', { revision: 3 }),
    event(15, 604, 'http.start', { path: 'dsh-session-groups/commit', method: 'POST' }),
    event(16, 1305, 'http.end', { path: 'dsh-session-groups/commit', method: 'POST', status: 200, ok: true, ms: 700 }),
    event(17, 1306, 'queue.reconcile', { revision: 4 }),
    event(18, 1310, 'native.drop', { phase: 'bubble', event: 'drop', x: 10, y: 40, trusted: true }),
    event(19, 1311, 'native.dragend', { phase: 'capture', event: 'dragend', x: null, y: null }),
    event(20, 1400, 'handler', { handler: 'onDragEnd', ms: 2 }),
  ]
  // 30 post-drop events to trip burst detection after the last pointer move.
  for (let index = 0; index < 30; index += 1) {
    events.push(event(21 + index, 1320 + index * 10, 'dropTarget.change', { from: null, to: { kind: 'group-append', groupId: 'g-1' } }))
  }
  events.push(event(60, 1700, 'perf.frame-gap', { gap: 140 }))
  events.push(event(61, 1750, 'perf.longtask', { duration: 120 }))
  return events.map((item) => envelope('run-a', 1, item))
}

test('parseTrace reads envelopes, raw events, blank lines and bad JSON', () => {
  const text = [
    envelope('run-a', 1, event(1, 0, 'run.start')),
    '',
    'not json',
    JSON.stringify({ v: 1, runId: 'run-raw', seq: 1, t: 0, type: 'run.start' }),
  ].join('\n')
  const parsed = parseTrace(text)
  assert.equal(parsed.records.length, 2)
  assert.equal(parsed.parseErrors.length, 1)
  assert.equal(parsed.records[0].runId, 'run-a')
  assert.equal(parsed.records[0].schemaVersion, 1)
  assert.equal(parsed.records[1].runId, 'run-raw')
  const groups = groupByRun(parsed.records)
  assert.equal(groups.size, 2)
})

test('summarizeRun covers counts, timelines, gaps, native/synthetic, optimistic/http and stalls', () => {
  const { records } = parseTrace(sampleLines().join('\n'))
  const run = summarizeRun('run-a', records)
  assert.equal(run.eventCount, 52)
  assert.equal(run.schemaMismatch, false)
  assert.equal(run.countsByType['native.dragover'], 2)
  assert.equal(run.countsByHandler.onDragOverSession, 1)
  assert.equal(run.native.count, 5)
  assert.equal(run.native.synthetic, 4)
  assert.equal(run.native.trusted, 1)
  assert.equal(run.targetChanges.length, 31)
  assert.equal(run.targetChanges[0].to, 'session-before:session=s-1')
  assert.deepEqual(run.labels.map((label) => label.text), ['放入『A』'])
  assert.equal(run.autoexpand.schedule, 1)
  assert.equal(run.autoexpand.fire, 1)
  assert.equal(run.placeholders.insert, 1)
  assert.equal(run.optimistic.enqueue, 1)
  assert.equal(run.optimistic.send, 1)
  assert.equal(run.optimistic.reconcile, 1)
  assert.equal(run.optimistic.http.length, 1)
  assert.equal(run.optimistic.http[0].ms, 700)
  assert.equal(run.optimistic.unsettled, false)
  assert.equal(run.frameGaps.length, 1)
  assert.equal(run.longTasks.length, 1)
  assert.equal(run.slowHandlers.length, 1)
  assert.equal(run.slowHandlers[0].handler, 'onDragOverSession')

  // target gap 510ms between seq 9 and 10 is the auto-expand timer wait.
  assert.ok(run.gaps.some((gap) => gap.ms >= 500))
  assert.ok(run.gaps.some((gap) => gap.afterType === 'http.start' && gap.beforeType === 'http.end'))
  assert.equal(run.burst.detected, true)
  assert.equal(run.burst.events, 14)
  const kinds = run.suspectedStalls.map((stall) => stall.kind)
  assert.ok(kinds.includes('frame-gap'))
  assert.ok(kinds.includes('longtask'))
  assert.ok(kinds.includes('slow-handler'))
  assert.ok(kinds.includes('slow-http'))
  assert.ok(kinds.includes('burst-after-last-pointer-move'))
})

test('summarizeRun flags unsettled writes, unknown schema and missing queue sends', () => {
  const records = [
    { runId: 'run-b', schemaVersion: 99, receivedAt: null, event: event(1, 0, 'drop.accept', { kind: 'ungrouped' }) },
    { runId: 'run-b', schemaVersion: 99, receivedAt: null, event: event(2, 10, 'queue.send', { revision: 1 }) },
  ]
  const run = summarizeRun('run-b', records)
  assert.equal(run.schemaMismatch, true)
  assert.equal(run.optimistic.unsettled, true)
  assert.ok(run.suspectedStalls.some((stall) => stall.kind === 'unsettled-optimistic-write'))

  const noQueue = summarizeRun('run-c', [
    { runId: 'run-c', schemaVersion: 1, receivedAt: null, event: event(1, 0, 'drop.accept', { kind: 'ungrouped' }) },
  ])
  assert.ok(noQueue.suspectedStalls.some((stall) => stall.kind === 'drop-without-queue-send'))
})

test('summarizeTrace filters by run and renderSummary prints the key lines', () => {
  const text = [sampleLines().join('\n'), envelope('run-other', 1, event(1, 0, 'run.start'))].join('\n')
  const all = summarizeTrace(text)
  assert.equal(all.runs.length, 2)
  const filtered = summarizeTrace(text, { runId: 'run-other' })
  assert.equal(filtered.runs.length, 1)
  assert.equal(filtered.runs[0].runId, 'run-other')

  const rendered = renderSummary(summarizeTrace(sampleLines().join('\n')))
  assert.match(rendered, /run run-a \(schema 1\)/)
  assert.match(rendered, /handlers: onDragOverSession=1/)
  assert.match(rendered, /autoexpand: schedule=1 fire=1 cancel=0/)
  assert.match(rendered, /placeholder: insert=1 remove=0/)
  assert.match(rendered, /optimistic: enqueue=1 coalesced=0 send=1 reconcile=1 rollback=0/)
  assert.match(rendered, /burst: lastMovement=native.dragover/)
  assert.match(rendered, /suspected stalls:/)
})
