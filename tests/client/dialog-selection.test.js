// tests/client/dialog-selection.test.js
//
// 0.2.6 selection-dialog contract: icon / move-to-group (session + group) /
// new-session workspace / group-color dialogs open on a visible current or
// inferred value, only accept known options, and hand Confirm a strict payload.
// The component renders these states; these pure helpers are the single source
// for initial highlight, validity and payload.

import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_GROUP_COLOR, GROUP_COLORS, GROUP_ICONS } from '../../src/shared/constants.js'
import {
  createGroup,
  emptyDoc,
  findGroup,
  normalizeColor,
} from '../../src/shared/model.js'
import {
  currentColorHexOf,
  currentColorOf,
  currentGroupIdOf,
  currentIconOf,
  currentParentOf,
  deleteGroupNeedsDialog,
  deleteGroupOptions,
  dialogConfirmPayload,
  findGroupsFlat,
  initialDialogSelection,
  isSelectionDialog,
  moveGroupOptions,
  selectionIsValid,
  SELECTION_DIALOG_KINDS,
} from '../../src/core/dialog-selection.js'

/** Root A -> child B; root C with one session; session s1 in A, s2 ungrouped. */
const fixture = () => {
  let doc = createGroup(emptyDoc(), { name: 'A', color: 'purple' })
  const a = doc.groups[0].id
  doc = createGroup(doc, { name: 'B', parentId: a })
  const b = doc.groups[1].id
  doc = createGroup(doc, { name: 'C' })
  const c = doc.groups.find((group) => group.name === 'C').id
  doc = createGroup(doc, { name: 'B-child', parentId: b })
  const bChild = doc.groups[3].id
  doc = { ...doc, groups: doc.groups.map((group) => (group.id === a ? { ...group, sessionIds: ['s1'] } : group)) }
  return { doc, a, b, c, bChild }
}

test('selection dialog kinds are exactly the small pickers plus group-color and delete-group', () => {
  assert.deepEqual([...SELECTION_DIALOG_KINDS], [
    'new-session',
    'move-session',
    'move-group',
    'icon',
    'group-color',
    'delete-group',
  ])
  for (const kind of SELECTION_DIALOG_KINDS) assert.equal(isSelectionDialog(kind), true)
  for (const kind of ['new-group', 'rename-group', 'rename-session', 'archive-running']) {
    assert.equal(isSelectionDialog(kind), false)
  }
})

test('initial highlight: current icon/color/parent/group, inferred workspace, else none', () => {
  const { doc, a, b } = fixture()
  assert.equal(initialDialogSelection({ kind: 'icon', current: 'star', icons: GROUP_ICONS }, doc), 'star')
  assert.equal(initialDialogSelection({ kind: 'icon', current: 'nope', icons: GROUP_ICONS }, doc), GROUP_ICONS[0])
  assert.equal(initialDialogSelection({ kind: 'group-color', current: 'orange' }, doc), 'orange')
  assert.equal(initialDialogSelection({ kind: 'group-color' }, doc), DEFAULT_GROUP_COLOR)
  assert.equal(initialDialogSelection({ kind: 'move-session', currentId: a }, doc), a)
  assert.equal(initialDialogSelection({ kind: 'move-session', currentId: null }, doc), null)
  assert.equal(initialDialogSelection({ kind: 'move-group', currentId: b }, doc), b)
  assert.equal(initialDialogSelection({ kind: 'move-group', currentId: null }, doc), null)
  assert.equal(initialDialogSelection({ kind: 'move-session' }, doc), undefined, 'missing current => nothing selected')
  const choices = [{ workspaceId: 'w1' }, { workspaceId: 'w2' }]
  assert.equal(initialDialogSelection({ kind: 'new-session', choices, inferred: 'w2' }, doc), 'w2')
  assert.equal(initialDialogSelection({ kind: 'new-session', choices, inferred: 'w9' }, doc), undefined)
  assert.equal(initialDialogSelection({ kind: 'new-session', choices: [] }, doc), undefined)
  assert.equal(initialDialogSelection(null, doc), undefined)
})

test('validity: only offered options confirm; move-group rejects self and descendants', () => {
  const { doc, a, b, c, bChild } = fixture()
  assert.equal(selectionIsValid({ kind: 'icon', icons: ['folder', 'star'] }, 'star', doc), true)
  assert.equal(selectionIsValid({ kind: 'icon', icons: ['folder', 'star'] }, 'rocket', doc), false)
  for (const color of GROUP_COLORS) assert.equal(selectionIsValid({ kind: 'group-color' }, color, doc), true)
  for (const bad of ['chartreuse', '', undefined, null, 3]) {
    assert.equal(selectionIsValid({ kind: 'group-color' }, bad, doc), false, `color ${String(bad)} must be invalid`)
  }
  const choices = [{ workspaceId: 'w1' }, { workspaceId: 'w2' }]
  assert.equal(selectionIsValid({ kind: 'new-session', choices }, 'w1', doc), true)
  assert.equal(selectionIsValid({ kind: 'new-session', choices }, 'w9', doc), false)
  assert.equal(selectionIsValid({ kind: 'new-session', choices: [] }, undefined, doc), false)
  assert.equal(selectionIsValid({ kind: 'move-session' }, a, doc), true)
  assert.equal(selectionIsValid({ kind: 'move-session' }, null, doc), true, 'Ungrouped is a valid move-session target')
  assert.equal(selectionIsValid({ kind: 'move-session' }, 'missing', doc), false)
  assert.equal(selectionIsValid({ kind: 'move-session' }, undefined, doc), false)
  assert.equal(selectionIsValid({ kind: 'move-group', groupId: c }, null, doc), true, 'root is a valid move-group target')
  assert.equal(selectionIsValid({ kind: 'move-group', groupId: c }, a, doc), true)
  assert.equal(selectionIsValid({ kind: 'move-group', groupId: a }, a, doc), false, 'cannot move into itself')
  assert.equal(selectionIsValid({ kind: 'move-group', groupId: a }, b, doc), false, 'cannot move into its child')
  assert.equal(selectionIsValid({ kind: 'move-group', groupId: a }, bChild, doc), false, 'cannot move into a deeper descendant')
  assert.equal(selectionIsValid({ kind: 'move-group', groupId: c }, 'missing', doc), false)
})

test('confirm payloads map to the host/model contract', () => {
  assert.deepEqual(dialogConfirmPayload({ kind: 'icon' }, 'star'), { icon: 'star' })
  assert.deepEqual(dialogConfirmPayload({ kind: 'group-color' }, 'purple'), { color: 'purple' })
  assert.deepEqual(dialogConfirmPayload({ kind: 'new-session' }, 'w1'), { workspaceId: 'w1' })
  assert.deepEqual(dialogConfirmPayload({ kind: 'move-session' }, 'g1'), { groupId: 'g1' })
  assert.deepEqual(dialogConfirmPayload({ kind: 'move-session' }, null), { groupId: null })
  assert.deepEqual(dialogConfirmPayload({ kind: 'move-group' }, null), { groupId: null })
  assert.deepEqual(dialogConfirmPayload({ kind: 'delete-group' }, undefined), {})
})

test('move options: flat list preserves sibling order/depth; move-group excludes the cycle subtree', () => {
  const { doc, a, b, c, bChild } = fixture()
  const flat = findGroupsFlat(doc)
  assert.deepEqual(flat.map((group) => [group.name, group.depth]), [
    ['A', 0],
    ['B', 1],
    ['B-child', 2],
    ['C', 0],
  ])
  assert.deepEqual(moveGroupOptions(doc, a).map((group) => group.id), [c], 'self and descendants are not offered')
  assert.deepEqual(moveGroupOptions(doc, b).map((group) => group.id), [a, c], 'parent stays a valid target')
  assert.equal(moveGroupOptions(doc, c).some((group) => group.id === bChild), true)
})

test('delete options exclude self and the recursive subtree, and keep root implicit', () => {
  const { doc, a, b, c, bChild } = fixture()
  assert.deepEqual(deleteGroupOptions(doc, a).map((group) => group.id), [c])
  assert.deepEqual(deleteGroupOptions(doc, b).map((group) => group.id), [a, c], 'the parent stays a valid destination')
  assert.deepEqual(deleteGroupOptions(doc, c).map((group) => group.id), [a, b, bChild])
  assert.deepEqual(deleteGroupOptions(doc, 'missing'), [])
})

test('delete options exclude destinations too shallow for a child subtree (root stays allowed)', () => {
  let deep = createGroup(emptyDoc(), { name: 'T' })
  const target = deep.groups[0].id
  let parentId = target
  const chain = []
  for (let i = 1; i <= 7; i += 1) {
    deep = createGroup(deep, { name: `C${i}`, parentId })
    parentId = deep.groups.find((group) => group.name === `C${i}`).id
    chain.push(parentId)
  }
  deep = createGroup(deep, { name: 'D1' })
  const d1 = deep.groups.find((group) => group.name === 'D1').id
  deep = createGroup(deep, { name: 'D2', parentId: d1 })
  const d2 = deep.groups.find((group) => group.name === 'D2').id
  const options = deleteGroupOptions(deep, target)
  assert.deepEqual(options.map((group) => group.id), [d1], 'depth-2 D2 is excluded, depth-1 D1 fits')
  for (const id of [target, ...chain, d2]) {
    assert.equal(options.some((group) => group.id === id), false, `${id} must not be offered`)
  }
})

test('delete dialog selection: no default, root/valid destinations confirm, invalid ones cannot', () => {
  const { doc, a, b, c, bChild } = fixture()
  assert.equal(initialDialogSelection({ kind: 'delete-group', groupId: a }, doc), undefined)
  assert.equal(selectionIsValid({ kind: 'delete-group', groupId: a }, null, doc), true, 'root/ungrouped is valid')
  assert.equal(selectionIsValid({ kind: 'delete-group', groupId: a }, c, doc), true)
  assert.equal(selectionIsValid({ kind: 'delete-group', groupId: a }, a, doc), false, 'self is not a destination')
  assert.equal(selectionIsValid({ kind: 'delete-group', groupId: a }, b, doc), false, 'child is not a destination')
  assert.equal(selectionIsValid({ kind: 'delete-group', groupId: a }, bChild, doc), false, 'grandchild is not a destination')
  assert.equal(selectionIsValid({ kind: 'delete-group', groupId: a }, 'missing', doc), false)
  assert.equal(selectionIsValid({ kind: 'delete-group', groupId: a }, undefined, doc), false)
  assert.deepEqual(dialogConfirmPayload({ kind: 'delete-group' }, null), { destinationId: null })
  assert.deepEqual(dialogConfirmPayload({ kind: 'delete-group' }, c), { destinationId: c })
  assert.deepEqual(dialogConfirmPayload({ kind: 'delete-group' }, undefined), {})
})

test('delete dialog is only required when the group has sessions or direct child groups', () => {
  const { doc, a, b, c } = fixture()
  assert.equal(deleteGroupNeedsDialog(doc, a), true, 'a direct session requires a destination')
  assert.equal(deleteGroupNeedsDialog(doc, b), true, 'a direct child group requires a destination')
  assert.equal(deleteGroupNeedsDialog(doc, c), false, 'empty leaf deletes directly')
  assert.equal(deleteGroupNeedsDialog(doc, 'missing'), false)
})

test('custom colorHex selection: current custom wins, validity and payload are distinct', () => {
  assert.equal(initialDialogSelection({ kind: 'group-color', current: 'purple', currentHex: '#A1B2C3' }, {}), '#a1b2c3')
  assert.equal(initialDialogSelection({ kind: 'group-color', current: 'purple', currentHex: 'not-hex' }, {}), 'purple')
  assert.equal(selectionIsValid({ kind: 'group-color' }, '#a1b2c3', {}), true)
  assert.equal(selectionIsValid({ kind: 'group-color' }, '#A1B2C3', {}), false, 'selection is canonical')
  assert.equal(selectionIsValid({ kind: 'group-color' }, 'purple', {}), true)
  assert.equal(selectionIsValid({ kind: 'group-color' }, undefined, {}), false)
  assert.deepEqual(dialogConfirmPayload({ kind: 'group-color' }, '#a1b2c3'), { colorHex: '#a1b2c3' })
  assert.deepEqual(dialogConfirmPayload({ kind: 'group-color' }, 'gray'), { color: 'gray' })
})


test('current value helpers: icon/color/parent/owning group with blue/root defaults', () => {
  const { doc, a, b, c } = fixture()
  assert.equal(currentIconOf(doc, a), 'hash', 'new groups default to the hash icon')
  assert.equal(currentColorOf(doc, a), 'purple')
  assert.equal(currentColorOf(doc, c), 'blue', 'legacy/missing color displays blue')
  assert.equal(currentColorOf(doc, 'missing'), 'blue')
  assert.equal(currentColorHexOf(doc, a), null)
  assert.equal(currentParentOf(doc, b), a)
  assert.equal(currentParentOf(doc, a), null)
  assert.equal(currentParentOf(doc, 'missing'), null)
  assert.equal(currentGroupIdOf(doc, 's1'), a)
  assert.equal(currentGroupIdOf(doc, 's2'), null, 'ungrouped sessions start on the Ungrouped option')
  assert.equal(currentGroupIdOf(doc, 'missing'), null)
  assert.equal(normalizeColor(findGroup(doc, a).color), 'purple')
})
