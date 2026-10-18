import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { emptyDoc } from '../../src/shared/model.js'
import { createStore } from '../../src/host/store.js'
import { makeTempStore, sampleDoc } from './helpers.js'

const sha256 = async (path) => createHash('sha256').update(await readFile(path)).digest('hex')

const list = async (dir) => (await readdir(dir)).sort()

test('H1: first load without a file returns the empty document at revision 0', async (t) => {
  const temp = await makeTempStore()
  t.after(temp.cleanup)
  const result = await temp.store.load()
  assert.equal(result.kind, 'ok')
  assert.equal(result.exists, false)
  assert.equal(result.revision, 0)
  assert.deepEqual(result.doc, emptyDoc())
})

test('H2/H5: commit writes revision+1, one .bak, and leaves no temp file', async (t) => {
  const temp = await makeTempStore()
  t.after(temp.cleanup)

  const first = await temp.store.commit(0, sampleDoc())
  assert.equal(first.kind, 'ok')
  assert.equal(first.revision, 1)
  assert.deepEqual(await list(temp.storages), ['dsh-session-groups.json'])
  const onDisk = JSON.parse(await readFile(temp.filePath, 'utf8'))
  assert.equal(onDisk.revision, 1)
  assert.deepEqual(onDisk, first.doc)

  const second = await temp.store.commit(1, { ...sampleDoc(), ungrouped: ['s-4', 's-5'] })
  assert.equal(second.kind, 'ok')
  assert.equal(second.revision, 2)
  assert.deepEqual(await list(temp.storages), ['dsh-session-groups.json', 'dsh-session-groups.json.bak'])
  assert.equal(JSON.parse(await readFile(temp.filePath + '.bak', 'utf8')).revision, 1)
  const tempFiles = (await list(temp.storages)).filter((name) => name.endsWith('.tmp'))
  assert.deepEqual(tempFiles, [])
})

test('H3: a stale baseRevision returns conflict with the current doc and never overwrites', async (t) => {
  const temp = await makeTempStore()
  t.after(temp.cleanup)
  await temp.store.commit(0, sampleDoc())
  await temp.store.commit(1, sampleDoc())
  const before = await sha256(temp.filePath)

  const stale = await temp.store.commit(1, { ...sampleDoc(), ungrouped: [] })
  assert.equal(stale.kind, 'conflict')
  assert.equal(stale.revision, 2)
  assert.equal(stale.doc.revision, 2)
  assert.equal(await sha256(temp.filePath), before)
})

test('H8: concurrent commits serialize; exactly one wins under the same baseRevision', async (t) => {
  const temp = await makeTempStore()
  t.after(temp.cleanup)
  const [left, right] = await Promise.all([
    temp.store.commit(0, { ...sampleDoc(), ungrouped: ['a'] }),
    temp.store.commit(0, { ...sampleDoc(), ungrouped: ['b'] }),
  ])
  assert.deepEqual([left.kind, right.kind].sort(), ['conflict', 'ok'])
  assert.equal(JSON.parse(await readFile(temp.filePath, 'utf8')).revision, 1)
})

test('H4: invalid documents are rejected by shared validateDoc and the file is untouched', async (t) => {
  const temp = await makeTempStore()
  t.after(temp.cleanup)
  await temp.store.commit(0, sampleDoc())
  const before = await sha256(temp.filePath)

  const duplicate = {
    version: 1,
    groups: [
      { id: 'g-a', name: 'A', parentId: null, sessionIds: ['s1'] },
      { id: 'g-b', name: 'B', parentId: null, sessionIds: ['s1'] },
    ],
    ungrouped: [],
  }
  const rejected = await temp.store.commit(1, duplicate)
  assert.equal(rejected.kind, 'invalid')
  assert.match(rejected.errors.join('\n'), /duplicate-session:s1/)
  assert.equal(await sha256(temp.filePath), before)
})

test('icon is opaque: an unknown short icon id is accepted and stored verbatim (C7)', async (t) => {
  const temp = await makeTempStore()
  t.after(temp.cleanup)
  const doc = sampleDoc()
  doc.groups[0].icon = 'future-icon'
  const committed = await temp.store.commit(0, doc)
  assert.equal(committed.kind, 'ok')
  assert.equal(JSON.parse(await readFile(temp.filePath, 'utf8')).groups[0].icon, 'future-icon')
})

test('the client-sent doc.revision is ignored; the host stamps revision', async (t) => {
  const temp = await makeTempStore()
  t.after(temp.cleanup)
  const result = await temp.store.commit(0, { ...sampleDoc(), revision: 999 })
  assert.equal(result.kind, 'ok')
  assert.equal(result.revision, 1)
  assert.equal(JSON.parse(await readFile(temp.filePath, 'utf8')).revision, 1)
})

test('H6: bad JSON is quarantined as .corrupt-* and degrades to empty + corrupt-file', async (t) => {
  const temp = await makeTempStore()
  t.after(temp.cleanup)
  const garbage = '{"version":1,"revision":2,"groups":['
  await writeFile(temp.filePath, garbage, 'utf8')

  const result = await temp.store.load()
  assert.equal(result.kind, 'ok')
  assert.equal(result.revision, 0)
  assert.deepEqual(result.doc, emptyDoc())
  assert.equal(result.warning, 'corrupt-file')
  assert.match(result.quarantinedTo, /dsh-session-groups\.corrupt-.*\.json$/)
  assert.equal(await readFile(result.quarantinedTo, 'utf8'), garbage)
  assert.equal(await sha256(temp.filePath).catch(() => 'missing'), 'missing')

  const recovered = await temp.store.commit(0, sampleDoc())
  assert.equal(recovered.kind, 'ok')
  assert.equal(recovered.revision, 1)
})

test('H6b: parseable but invariant-breaking JSON is quarantined as invalid-file', async (t) => {
  const temp = await makeTempStore()
  t.after(temp.cleanup)
  await writeFile(
    temp.filePath,
    JSON.stringify({
      version: 1,
      revision: 3,
      groups: [{ id: 'g-a', name: '', parentId: null, sessionIds: ['s1'] }],
      ungrouped: ['s1'],
    }),
    'utf8',
  )
  const result = await temp.store.load()
  assert.equal(result.kind, 'ok')
  assert.equal(result.warning, 'invalid-file')
  assert.equal(result.revision, 0)
  assert.match(result.detail, /duplicate-session:s1/)
})

test('H7: version > 1 is unsupported-version, never overwritten', async (t) => {
  const temp = await makeTempStore()
  t.after(temp.cleanup)
  const future = JSON.stringify({ version: 2, revision: 5, groups: [], ungrouped: [] })
  await writeFile(temp.filePath, future, 'utf8')
  const before = await sha256(temp.filePath)

  const load = await temp.store.load()
  assert.equal(load.kind, 'unsupported-version')
  assert.equal(load.version, 2)

  const commit = await temp.store.commit(5, sampleDoc())
  assert.equal(commit.kind, 'unsupported-version')
  assert.equal(await sha256(temp.filePath), before)
})

test('S7 crash window: leftover temp files are inert and never affect the record', async (t) => {
  const temp = await makeTempStore()
  t.after(temp.cleanup)
  await temp.store.commit(0, sampleDoc())

  const uniqueLeftover = `${temp.filePath}.${process.pid}.deadbeef.tmp`
  const legacyLeftover = `${temp.filePath}.tmp`
  await writeFile(uniqueLeftover, '{"version":1,"revision":99,"groups":["truncated')
  await writeFile(legacyLeftover, '{"truncated')

  const loaded = await temp.store.load()
  assert.equal(loaded.kind, 'ok')
  assert.equal(loaded.revision, 1)
  assert.deepEqual(loaded.doc.ungrouped, ['s-4'])

  const next = await temp.store.commit(1, sampleDoc())
  assert.equal(next.kind, 'ok')
  assert.equal(next.revision, 2)
  const files = await list(temp.storages)
  assert.equal(files.includes(`dsh-session-groups.json.${process.pid}.deadbeef.tmp`), true)
  assert.equal(files.includes('dsh-session-groups.json.tmp'), true)
  const ownTemps = files.filter((name) => /^dsh-session-groups\.json\.\d+\.[0-9a-f]{8}\.tmp$/.test(name))
  assert.deepEqual(ownTemps, [`dsh-session-groups.json.${process.pid}.deadbeef.tmp`])
})

test('H10: only the record file family is written next to unrelated host data', async (t) => {
  const temp = await makeTempStore()
  t.after(temp.cleanup)
  const sentinel = join(temp.storages, 'workspace.json')
  await writeFile(sentinel, '{"workspaces":[]}\n', 'utf8')
  const before = await sha256(sentinel)

  await temp.store.commit(0, sampleDoc())
  await temp.store.commit(1, sampleDoc())

  assert.equal(await sha256(sentinel), before)
  assert.deepEqual(await list(temp.storages), [
    'dsh-session-groups.json',
    'dsh-session-groups.json.bak',
    'workspace.json',
  ])
})

test('save() stamps the next revision and persists a clean document', async (t) => {
  const temp = await makeTempStore()
  t.after(temp.cleanup)
  const saved = await temp.store.save(sampleDoc())
  assert.equal(saved.revision, 1)
  const loaded = await temp.store.load()
  assert.equal(loaded.revision, 1)
  assert.deepEqual(loaded.doc, saved)
})

test('load propagates genuine IO errors (record path is a directory)', async (t) => {
  const temp = await makeTempStore()
  t.after(temp.cleanup)
  await mkdir(temp.filePath, { recursive: true })
  const store = createStore({ filePath: temp.filePath })
  await assert.rejects(() => store.load(), /EISDIR|illegal operation on a directory/)
})
