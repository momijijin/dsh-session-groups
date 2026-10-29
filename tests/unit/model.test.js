import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_GROUP_COLOR, DEFAULT_NEW_GROUP_ICON, GROUP_COLORS } from '../../src/shared/constants.js'
import {
  assignSession,
  buildRenderTree,
  childrenOf,
  createGroup,
  deleteGroup,
  emptyDoc,
  groupColor,
  groupColorHex,
  groupColorValue,
  inferWorkspaceId,
  isColorHex,
  isDescendant,
  isKnownColor,
  moveGroup,
  normalizeColor,
  normalizeColorHex,
  normalizeDoc,
  removeSession,
  renameGroup,
  reorderUngrouped,
  setGroupColor,
  setGroupColorHex,
  setGroupIcon,
  validateDoc,
  workspaceLabel,
  workspaceOfSession,
} from '../../src/shared/model.js'

const ws = (workspaceId, title, path, sessionIds = []) => ({ workspaceId, title, path, sessionIds })

test('emptyDoc is valid and versioned', () => {
  const doc = emptyDoc()
  assert.equal(doc.version, 1)
  assert.equal(doc.revision, 0)
  assert.deepEqual(doc.groups, [])
  assert.deepEqual(doc.ungrouped, [])
  assert.equal(validateDoc(doc).ok, true)
})

test('createGroup trims names, normalizes icons and nests', () => {
  let doc = createGroup(emptyDoc(), { name: '  施工中  ', icon: 'rocket' })
  assert.equal(doc.groups[0].name, '施工中')
  assert.equal(doc.groups[0].icon, 'rocket')
  doc = createGroup(doc, { name: '默认图标' })
  assert.equal(doc.groups[1].icon, DEFAULT_NEW_GROUP_ICON, 'new groups default to hash')
  assert.equal(doc.groups[1].icon, 'hash')
  doc = createGroup(doc, { name: '子组', icon: 'not-an-icon', parentId: doc.groups[0].id })
  assert.equal(doc.groups[2].icon, 'folder', 'invalid explicit icons still normalize to the legacy fallback')
  assert.equal(doc.groups[2].parentId, doc.groups[0].id)
  assert.deepEqual(childrenOf(doc, doc.groups[0].id).map((g) => g.name), ['子组'])
})

test('createGroup rejects empty and too-long names', () => {
  assert.throws(() => createGroup(emptyDoc(), { name: '   ' }), /name-required/)
  assert.throws(() => createGroup(emptyDoc(), { name: 'x'.repeat(81) }), /name-too-long/)
})

test('renameGroup and setGroupIcon update only the target', () => {
  let doc = createGroup(emptyDoc(), { name: 'A' })
  const id = doc.groups[0].id
  doc = renameGroup(doc, id, ' B ')
  doc = setGroupIcon(doc, id, 'star')
  assert.equal(doc.groups[0].name, 'B')
  assert.equal(doc.groups[0].icon, 'star')
})

test('group palette: default blue, known colors, setGroupColor, unknown -> blue', () => {
  assert.deepEqual([...GROUP_COLORS], ['blue', 'green', 'orange', 'red', 'purple', 'gray'])
  assert.equal(DEFAULT_GROUP_COLOR, 'blue')
  assert.equal(isKnownColor('purple'), true)
  assert.equal(isKnownColor('pink'), false)
  assert.equal(normalizeColor(undefined), 'blue')
  assert.equal(normalizeColor('pink'), 'blue')
  assert.equal(normalizeColor('gray'), 'gray')

  let doc = createGroup(emptyDoc(), { name: 'A' })
  assert.equal(doc.groups[0].color, 'blue', 'new groups default to blue')
  doc = createGroup(doc, { name: 'B', color: 'purple' })
  assert.equal(doc.groups[1].color, 'purple')
  doc = createGroup(doc, { name: 'C', color: 'not-a-color' })
  assert.equal(doc.groups[2].color, 'blue', 'unknown input normalizes to blue')

  const a = doc.groups[0].id
  doc = setGroupColor(doc, a, 'orange')
  assert.equal(groupColor(doc.groups[0]), 'orange')
  assert.equal(groupColor({ name: 'legacy' }), 'blue', 'docs without color display blue')
  assert.equal(groupColor(null), 'blue')
  assert.throws(() => setGroupColor(doc, 'missing', 'red'), /group-not-found/)
  assert.equal(doc.groups[0].color, 'orange', 'setGroupColor is pure')
})

test('custom colorHex: normalization, precedence, validation and quarantine shape', () => {
  assert.equal(normalizeColorHex('#A1B2C3'), '#a1b2c3')
  assert.equal(normalizeColorHex('a1b2c3'), '#a1b2c3')
  assert.equal(normalizeColorHex('#abc'), '#aabbcc')
  assert.equal(normalizeColorHex('ABC'), '#aabbcc')
  assert.equal(normalizeColorHex('#abcd'), null, 'alpha short form is rejected')
  assert.equal(normalizeColorHex('#11223344'), null, 'alpha long form is rejected')
  assert.equal(normalizeColorHex('red'), null)
  assert.equal(normalizeColorHex(''), null)
  assert.equal(isColorHex('#a1b2c3'), true)
  assert.equal(isColorHex('#A1B2C3'), false, 'persisted shape is canonical lowercase')
  assert.equal(isColorHex('#abc'), false)

  let doc = createGroup(emptyDoc(), { name: 'A', color: 'purple', colorHex: '#A1B2C3' })
  assert.equal(doc.groups[0].colorHex, '#a1b2c3')
  assert.equal(groupColorHex(doc.groups[0]), '#a1b2c3')
  assert.equal(groupColorValue(doc.groups[0]), '#a1b2c3', 'colorHex wins over the palette')
  assert.equal(groupColor(doc.groups[0]), 'purple', 'palette identity stays available')
  assert.equal(validateDoc(doc).ok, true)

  const id = doc.groups[0].id
  doc = setGroupColorHex(doc, id, '#0F0')
  assert.equal(doc.groups[0].colorHex, '#00ff00')
  doc = setGroupColor(doc, id, 'orange')
  assert.equal(doc.groups[0].colorHex, undefined, 'picking a preset clears the custom color')
  assert.equal(groupColorValue(doc.groups[0]), 'orange')

  const invalidHex = { ...doc, groups: [{ ...doc.groups[0], colorHex: '#A1B2C3' }] }
  const verdict = validateDoc(invalidHex)
  assert.equal(verdict.ok, false)
  assert.match(verdict.errors.join(';'), /group-color-hex/)
  for (const bad of ['#abcd', '#11223344', 'red', '', 7]) {
    const invalid = { ...doc, groups: [{ ...doc.groups[0], colorHex: bad }] }
    assert.equal(validateDoc(invalid).ok, false, `colorHex ${JSON.stringify(bad)} must be rejected`)
  }

  const normalized = normalizeDoc({ version: 1, revision: 0, groups: [{ id: 'g1', name: 'A', icon: 'folder', colorHex: '#A1B2C3', parentId: null, sessionIds: [] }], ungrouped: [] })
  assert.equal(normalized.groups[0].colorHex, '#a1b2c3')
  assert.equal(validateDoc(normalized).ok, true)
})

test('validateDoc: color is optional but must be a known palette id when present', () => {
  const doc = createGroup(emptyDoc(), { name: 'A' })
  const group = doc.groups[0]
  assert.equal(validateDoc(doc).ok, true)
  for (const color of GROUP_COLORS) {
    const valid = { ...doc, groups: [{ ...group, color }] }
    assert.equal(validateDoc(valid).ok, true, color)
  }
  const legacyGroup = { ...group }
  delete legacyGroup.color
  assert.equal(validateDoc({ ...doc, groups: [legacyGroup] }).ok, true, 'legacy groups without color stay valid')
  for (const color of ['pink', '', 7, null, true]) {
    const verdict = validateDoc({ ...doc, groups: [{ ...group, color }] })
    assert.equal(verdict.ok, false, `color ${JSON.stringify(color)} must be rejected`)
    assert.match(verdict.errors.join(';'), /group-color/)
  }
})

test('moveGroup reorders siblings and keeps the subtree', () => {
  let doc = createGroup(emptyDoc(), { name: 'A' })
  doc = createGroup(doc, { name: 'B' })
  doc = createGroup(doc, { name: 'C', parentId: doc.groups[0].id })
  const a = doc.groups.find((g) => g.name === 'A')
  doc = moveGroup(doc, a.id, null, 1)
  assert.deepEqual(childrenOf(doc, null).map((g) => g.name), ['B', 'A'])
  assert.equal(childrenOf(doc, doc.groups.find((g) => g.name === 'A').id).length, 1)
})

test('moveGroup rejects cycles and depth overflow', () => {
  let doc = createGroup(emptyDoc(), { name: 'A' })
  const a = doc.groups[0].id
  doc = createGroup(doc, { name: 'B', parentId: a })
  const b = doc.groups[1].id
  assert.throws(() => moveGroup(doc, a, b, 0), /cycle/)
  assert.throws(() => moveGroup(doc, a, a, 0), /cycle/)
  assert.equal(isDescendant(doc, b, a), true)

  let deep = emptyDoc()
  let parentId = null
  for (let i = 0; i < 8; i += 1) {
    deep = createGroup(deep, { name: `L${i}`, parentId })
    parentId = deep.groups[deep.groups.length - 1].id
  }
  assert.throws(() => createGroup(deep, { name: 'L9', parentId }), /depth-exceeded/)
})

test('deleteGroup promotes children and moves sessions to parent head', () => {
  let doc = createGroup(emptyDoc(), { name: 'A' })
  const a = doc.groups[0].id
  doc = createGroup(doc, { name: 'B', parentId: a })
  const b = doc.groups.find((g) => g.name === 'B').id
  doc = createGroup(doc, { name: 'C' })
  const c = doc.groups.find((g) => g.name === 'C').id
  doc = assignSession(doc, 's1', a, 0)
  doc = assignSession(doc, 's2', b, 0)
  doc = assignSession(doc, 's3', c, 0)
  doc = deleteGroup(doc, a)
  assert.equal(doc.groups.some((g) => g.id === a), false)
  assert.equal(doc.groups.find((g) => g.id === b).parentId, null)
  assert.deepEqual(doc.ungrouped.slice(0, 1), ['s1'])
  assert.deepEqual(doc.groups.find((g) => g.id === b).sessionIds, ['s2'])
})

test('assignSession moves across groups without duplication', () => {
  let doc = createGroup(emptyDoc(), { name: 'A' })
  const a = doc.groups[0].id
  doc = createGroup(doc, { name: 'B' })
  const b = doc.groups[1].id
  doc = assignSession(doc, 's1', a)
  doc = assignSession(doc, 's2', a)
  doc = assignSession(doc, 's1', b, 0)
  assert.deepEqual(doc.groups.find((g) => g.id === a).sessionIds, ['s2'])
  assert.deepEqual(doc.groups.find((g) => g.id === b).sessionIds, ['s1'])
  doc = assignSession(doc, 's2', null, 0)
  assert.deepEqual(doc.ungrouped, ['s2'])
  doc = removeSession(doc, 's2')
  assert.deepEqual(doc.ungrouped, [])
})

test('reorderUngrouped dedupes and keeps order', () => {
  let doc = assignSession(emptyDoc(), 's1', null)
  doc = assignSession(doc, 's2', null)
  doc = reorderUngrouped(doc, ['s2', 's1', 's2', ''])
  assert.deepEqual(doc.ungrouped, ['s2', 's1'])
})

test('validateDoc catches duplicate sessions, missing parents and cycles', () => {
  const doc = {
    version: 1,
    revision: 1,
    groups: [
      { id: 'g1', name: 'A', icon: 'folder', parentId: 'g2', sessionIds: ['s1'] },
      { id: 'g2', name: 'B', icon: 'folder', parentId: 'g1', sessionIds: ['s1'] },
    ],
    ungrouped: [],
  }
  const result = validateDoc(doc)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((e) => e.includes('duplicate-session')))
  assert.ok(result.errors.some((e) => e.includes('cycle')))
})

test('buildRenderTree applies archive tri-state, hides subagent/blank, keeps empty groups', () => {
  let doc = createGroup(emptyDoc(), { name: 'A' })
  const a = doc.groups[0].id
  doc = createGroup(doc, { name: 'Empty' })
  doc = assignSession(doc, 's1', a)
  const sessions = {
    s1: { id: 's1', updatedAt: 10 },
    s2: { id: 's2', updatedAt: 20 },
    s3: { id: 's3', updatedAt: 30, origin: 'subagent', parentId: 's1' },
    s4: { id: 's4', updatedAt: 40, blank: true },
    s5: { id: 's5', updatedAt: 50 },
  }
  const workspaces = [ws('w1', 'W1', 'C:/p/w1', ['s1', 's2', 's3', 's4', 's5'])]
  const statuses = new Map([['s1', { running: true }]])

  const hidden = buildRenderTree(doc, sessions, workspaces, {
    archivedSessionIds: ['s2'],
    filter: 'hidden',
    currentSessionId: null,
    statuses,
  })
  assert.deepEqual(hidden.ungrouped.map((n) => n.session.id), ['s5'])
  const aNode = hidden.groups.find((n) => n.group.id === a)
  assert.equal(aNode.visibleCount, 1)
  assert.equal(aNode.children[0].status.running, true)
  assert.equal(hidden.groups.find((n) => n.group.name === 'Empty').emptyVisible, true)

  const all = buildRenderTree(doc, sessions, workspaces, { archivedSessionIds: ['s2'], filter: 'all' })
  assert.ok(all.ungrouped.some((n) => n.session.id === 's2' && n.archived === true))
  assert.equal(all.ungrouped.some((n) => n.session.id === 's3'), false)
  assert.equal(all.ungrouped.some((n) => n.session.id === 's4'), false)

  const only = buildRenderTree(doc, sessions, workspaces, {
    archivedSessionIds: ['s2'],
    filter: 'only',
    currentSessionId: null,
  })
  assert.deepEqual(only.ungrouped.map((n) => n.session.id), ['s2'])

  const blankCurrent = buildRenderTree(doc, sessions, workspaces, {
    archivedSessionIds: [],
    filter: 'all',
    currentSessionId: 's4',
  })
  assert.equal(blankCurrent.ungrouped.some((n) => n.session.id === 's4'), true)

  const counted = buildRenderTree(doc, sessions, workspaces, {
    archivedSessionIds: [],
    filter: 'hidden',
    currentSessionId: null,
    statuses,
    subagentCounts: new Map([['s1', 2]]),
  })
  const countedNode = counted.groups.find((n) => n.group.id === a).children.find((n) => n.session.id === 's1')
  assert.equal(countedNode.runningSubagentCount, 2)
  const plainNode = counted.ungrouped.find((n) => n.session.id === 's5')
  assert.equal(plainNode.runningSubagentCount, 0)
})

test('ungrouped derives unseen sessions newest-first before stored order', () => {
  let doc = assignSession(emptyDoc(), 'old', null, 0)
  const sessions = {
    old: { id: 'old', updatedAt: 1 },
    new1: { id: 'new1', updatedAt: 10 },
    new2: { id: 'new2', updatedAt: 20 },
  }
  const tree = buildRenderTree(doc, sessions, [], { filter: 'all', archivedSessionIds: [] })
  assert.deepEqual(tree.ungrouped.map((n) => n.session.id), ['new2', 'new1', 'old'])
})

test('workspace mapping and inference follow D6', () => {
  let doc = createGroup(emptyDoc(), { name: 'A' })
  const a = doc.groups[0].id
  doc = assignSession(doc, 's1', a, 0)
  doc = assignSession(doc, 's2', a, 1)
  const w1 = ws('w1', 'W1', 'C:/p/w1', ['s1', 's3'])
  const w2 = ws('w2', 'W2', 'C:/p/w2', ['s2', 's4'])
  const sessions = { s1: {}, s2: {}, s3: {}, s4: {} }
  assert.equal(workspaceOfSession([w1, w2], 's2').workspaceId, 'w2')
  assert.equal(inferWorkspaceId(doc, a, sessions, [w1, w2], 's3'), 'w1')
  assert.equal(inferWorkspaceId(doc, a, sessions, [w1, w2], 's4'), 'w2')
  const empty = createGroup(doc, { name: 'Empty' })
  assert.equal(inferWorkspaceId(empty, empty.groups[1].id, sessions, [w1, w2], 's4'), 'w2')
  assert.equal(workspaceLabel(w1), 'W1')
  assert.equal(workspaceLabel({ path: 'C:/p/foo' }), 'foo')
})

test('normalizeDoc drops duplicates and repairs bad parents', () => {
  const doc = normalizeDoc({
    version: 1,
    revision: 4,
    groups: [
      { id: 'g1', name: ' A ', icon: 'star', parentId: 'missing', sessionIds: ['s1', 's1'] },
      { id: 'g1', name: 'dup', icon: 'folder', parentId: null, sessionIds: ['s2'] },
    ],
    ungrouped: ['s1', 's3', 's3'],
  })
  assert.equal(doc.groups.length, 1)
  assert.equal(doc.groups[0].name, 'A')
  assert.equal(doc.groups[0].parentId, null)
  assert.deepEqual(doc.groups[0].sessionIds, ['s1'])
  assert.deepEqual(doc.ungrouped, ['s3'])
  assert.equal(doc.groups[0].color, 'blue', 'normalizeDoc fills the blue default for legacy docs')
  const colored = normalizeDoc({
    version: 1,
    revision: 0,
    groups: [
      { id: 'g1', name: 'A', icon: 'folder', color: 'purple', parentId: null, sessionIds: [] },
      { id: 'g2', name: 'B', icon: 'folder', color: 'pink', parentId: null, sessionIds: [] },
    ],
    ungrouped: [],
  })
  assert.equal(colored.groups[0].color, 'purple')
  assert.equal(colored.groups[1].color, 'blue')
  assert.equal(validateDoc(colored).ok, true)
})
