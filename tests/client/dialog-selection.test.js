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
  currentColorOf,
  currentGroupIdOf,
  currentIconOf,
  currentParentOf,
  dialogConfirmPayload,
  findGroupsFlat,
  initialDialogSelection,
  isSelectionDialog,
  moveGroupOptions,
  selectionIsValid,
  SELECTION_DIALOG_KINDS,
} from '../../src/client/dialog-selection.js'

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

test('selection dialog kinds are exactly the four small pickers plus group-color', () => {
  assert.deepEqual([...SELECTION_DIALOG_KINDS], ['new-session', 'move-session', 'move-group', 'icon', 'group-color'])
  for (const kind of SELECTION_DIALOG_KINDS) assert.equal(isSelectionDialog(kind), true)
  for (const kind of ['new-group', 'rename-group', 'rename-session', 'delete-group', 'archive-running']) {
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
  for (const bad of ['pink', '', undefined, null, 3]) {
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

test('current value helpers: icon/color/parent/owning group with blue/root defaults', () => {
  const { doc, a, b, c } = fixture()
  assert.equal(currentIconOf(doc, a), 'folder')
  assert.equal(currentColorOf(doc, a), 'purple')
  assert.equal(currentColorOf(doc, c), 'blue', 'legacy/missing color displays blue')
  assert.equal(currentColorOf(doc, 'missing'), 'blue')
  assert.equal(currentParentOf(doc, b), a)
  assert.equal(currentParentOf(doc, a), null)
  assert.equal(currentParentOf(doc, 'missing'), null)
  assert.equal(currentGroupIdOf(doc, 's1'), a)
  assert.equal(currentGroupIdOf(doc, 's2'), null, 'ungrouped sessions start on the Ungrouped option')
  assert.equal(currentGroupIdOf(doc, 'missing'), null)
  assert.equal(normalizeColor(findGroup(doc, a).color), 'purple')
})
