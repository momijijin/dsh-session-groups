import test from 'node:test'
import assert from 'node:assert/strict'

import {
  installPerfApi,
  perfCount,
  perfDragOver,
  perfDropTarget,
  perfEnabled,
  perfMark,
  perfNow,
  perfRender,
  perfReset,
  perfSample,
  perfSnapshot,
} from '../../src/client/perf.js'

const clearFlag = () => {
  try { delete globalThis.__DSG_PERF__ } catch { globalThis.__DSG_PERF__ = undefined }
}

test('perf helpers are disabled by default and opt in from the global flag', () => {
  clearFlag()
  const disabled = perfReset()
  assert.equal(disabled.enabled, false)
  assert.equal(perfEnabled(), false)
  perfCount('ignored')
  perfRender('ignored')
  perfSample('dragOverMs', 10)
  perfMark('ignored')
  perfDragOver('ignored', 10)
  perfDropTarget(true, 10)
  assert.deepEqual(perfSnapshot().counters, {})
  assert.equal(perfSnapshot().marks.length, 0)

  globalThis.__DSG_PERF__ = true
  assert.equal(perfReset().enabled, true)
  assert.equal(perfEnabled(), true)
  clearFlag()
  perfReset()
})

test('perf aggregates counters, samples, marks and drag/drop durations', () => {
  globalThis.__DSG_PERF__ = true
  perfReset()
  try {
    perfCount('commits', 2)
    perfCount('commits')
    perfRender('SessionRow')
    perfRender('SessionRow')
    perfSample('dragOverMs', 1.234)
    perfSample('dragOverMs', Number.NaN)
    perfSample('unknownSample', 1)
    perfMark('drop', { target: 's1' })
    perfDragOver('onDragOverSession', 4.5, { invalid: true })
    perfDragOver('onDragOverSession', 2)
    perfDropTarget(true, 3)
    perfDropTarget(false)

    const snapshot = perfSnapshot()
    assert.equal(snapshot.enabled, true)
    assert.equal(snapshot.counters.commits, 3)
    assert.equal(snapshot.renders.SessionRow, 2)
    assert.equal(snapshot.marks.length, 1)
    assert.deepEqual(snapshot.marks[0].detail, { target: 's1' })
    assert.equal(snapshot.dragOver.events, 2)
    assert.equal(snapshot.dragOver.invalid, 1)
    assert.equal(snapshot.dragOver.maxMs, 4.5)
    assert.equal(snapshot.dragOver.avgMs, 3.25)
    assert.equal(snapshot.dropTarget.calls, 2)
    assert.equal(snapshot.dropTarget.changes, 1)
    assert.deepEqual(snapshot.samples.dragOverMs, { count: 3, min: 1.23, avg: 2.58, p50: 2, p95: 4.5, max: 4.5 })
    assert.equal(typeof perfNow(), 'number')
  } finally {
    clearFlag()
    perfReset()
  }
})

test('perf bounds samples and marks and exposes the probe API', () => {
  globalThis.__DSG_PERF__ = true
  perfReset()
  try {
    for (let index = 0; index < 401; index += 1) perfSample('dragOverMs', index)
    for (let index = 0; index < 4001; index += 1) perfMark('mark', index)
    const snapshot = perfSnapshot()
    assert.equal(snapshot.samples.dragOverMs.count, 400)
    assert.equal(snapshot.samples.dragOverMs.min, 1)
    assert.equal(snapshot.samples.dragOverMs.max, 400)
    assert.equal(snapshot.marks.length, 4000)
    assert.equal(snapshot.marks[0].detail, 1)

    installPerfApi()
    assert.equal(typeof globalThis.__dsgPerfApi.snapshot, 'function')
    assert.equal(typeof globalThis.__dsgPerfApi.reset, 'function')
    assert.equal(globalThis.__dsgPerfApi.enabled(), true)
  } finally {
    clearFlag()
    perfReset()
    delete globalThis.__dsgPerfApi
  }
})
