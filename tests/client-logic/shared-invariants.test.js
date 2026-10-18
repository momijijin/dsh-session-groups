// tests/client-logic/shared-invariants.test.js
//
// V1 QA - independent client-logic invariants that complement (do not duplicate)
// the implementation-owned unit tests in tests/unit and the Host/Client tests in
// tests/host, tests/client. Focus: the frozen CONTRACTS invariants §1/§3 and
// TEST-PLAN §2/§4 rows that are easy to regress at the integration seams:
//   * ungrouped derivation (invariant 8: derived newest-first + stored manual order)
//   * archive tri-state + empty groups
//   * subagent/fork/blank visibility rules (origin !== parentId)
//   * orphan session ids preserved in the doc but never rendered
//   * inferWorkspaceId D6 matrix
//   * deterministic tree building / doc immutability
//   * validate/normalize error taxonomy

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRenderTree,
  cloneDoc,
  createGroup,
  deleteGroup,
  emptyDoc,
  inferWorkspaceId,
  moveGroup,
  normalizeDoc,
  removeSession,
  assignSession,
  validateDoc,
} from '../../src/shared/model.js';

const group = (id, parentId = null) => ({ id, name: id, icon: 'folder', parentId, sessionIds: [] });
const docOf = (groups = [], ungrouped = []) => ({ version: 1, revision: 0, groups, ungrouped });
const session = (id, extra = {}) => ({ id, title: id, updatedAt: 0, ...extra });
const workspace = (workspaceId, sessionIds) => ({ workspaceId, title: workspaceId, path: `C:\\w\\${workspaceId}`, sessionIds });

const ids = (nodes) => nodes.map((node) => node.session?.id ?? node.group?.id ?? node.id);
const sessionIds = (nodes) => nodes.filter((node) => node.kind === 'session').map((node) => node.session.id);

test('invariant 8: ungrouped = derived newest-first, then the stored manual order; assigned sessions excluded', () => {
  const doc = docOf([{ ...group('g1'), sessionIds: ['assigned'] }], ['storedB', 'storedA']);
  const sessions = {
    assigned: session('assigned', { updatedAt: 100 }),
    storedA: session('storedA', { updatedAt: 1 }),
    storedB: session('storedB', { updatedAt: 2 }),
    newest: session('newest', { updatedAt: 400 }),
    older: session('older', { updatedAt: 300 }),
  };
  const tree = buildRenderTree(doc, sessions, [], { filter: 'hidden' });
  assert.deepEqual(ids(tree.ungrouped), ['newest', 'older', 'storedB', 'storedA']);
  assert.deepEqual(tree.groups[0].children.map((node) => node.session.id), ['assigned']);
});

test('archive tri-state: hidden/all/only and empty-group visibility', () => {
  const doc = docOf([{ ...group('g1'), sessionIds: ['live'] }, { ...group('g2'), sessionIds: ['archived'] }]);
  const sessions = { live: session('live'), archived: session('archived') };
  const options = { archivedSessionIds: ['archived'], filter: 'hidden' };

  const hidden = buildRenderTree(doc, sessions, [], options);
  assert.deepEqual(hidden.groups.map((node) => node.group.id), ['g1', 'g2']);
  assert.deepEqual(sessionIds(hidden.groups[0].children), ['live']);
  assert.equal(hidden.groups[1].visibleCount, 0);
  assert.equal(hidden.groups[1].emptyVisible, true, 'groups never disappear; emptyVisible drives the empty row');

  const all = buildRenderTree(doc, sessions, [], { ...options, filter: 'all' });
  assert.deepEqual(sessionIds(all.groups[1].children), ['archived']);
  assert.equal(all.groups[1].children[0].archived, true, 'all keeps archived rows muted');

  const only = buildRenderTree(doc, sessions, [], { ...options, filter: 'only' });
  assert.equal(only.groups[0].visibleCount, 0);
  assert.deepEqual(sessionIds(only.groups[1].children), ['archived']);
});

test('visibility: subagent excluded by origin; fork (parentId only) kept; blank only when current', () => {
  const doc = docOf([], ['fork', 'subagent', 'blankCurrent', 'blankOther']);
  const sessions = {
    fork: session('fork', { parentId: 'parent-1' }), // fork lineage, not a subagent
    subagent: session('subagent', { origin: 'subagent' }),
    blankCurrent: session('blankCurrent', { blank: true }),
    blankOther: session('blankOther', { blank: true }),
  };
  const tree = buildRenderTree(doc, sessions, [], { filter: 'hidden', currentSessionId: 'blankCurrent' });
  const visible = ids(tree.ungrouped);
  assert.equal(visible.includes('fork'), true, 'fork (parentId present, no origin) must not be hidden');
  assert.equal(visible.includes('subagent'), false, 'origin === "subagent" must be hidden');
  assert.equal(visible.includes('blankCurrent'), true, 'current blank is visible');
  assert.equal(visible.includes('blankOther'), false, 'other blanks are hidden');
});

test('orphans: unknown session ids stay in the doc but are never rendered', () => {
  const doc = docOf([{ ...group('g1'), sessionIds: ['known', 'ghost'] }], ['ghost2']);
  const sessions = { known: session('known') };
  const tree = buildRenderTree(doc, sessions, [], { filter: 'hidden' });
  assert.deepEqual(sessionIds(tree.groups[0].children), ['known']);
  assert.deepEqual(ids(tree.ungrouped), []);
  assert.equal(doc.groups[0].sessionIds.includes('ghost'), true, 'orphans are preserved until P1 cleanup');
  assert.equal(doc.ungrouped.includes('ghost2'), true);
});

test('inferWorkspaceId D6: homogeneous -> that workspace; mixed/empty -> current; no current -> null', () => {
  const workspaces = [workspace('wa', ['a1', 'a2']), workspace('wb', ['b1'])];
  const sessionsById = { a1: session('a1'), a2: session('a2'), b1: session('b1') };

  const homogeneous = docOf([{ ...group('g1'), sessionIds: ['a1', 'a2'] }]);
  assert.equal(inferWorkspaceId(homogeneous, 'g1', sessionsById, workspaces, 'b1'), 'wa');

  const mixed = docOf([{ ...group('g1'), sessionIds: ['a1', 'b1'] }]);
  assert.equal(inferWorkspaceId(mixed, 'g1', sessionsById, workspaces, 'b1'), 'wb');
  assert.equal(inferWorkspaceId(mixed, 'g1', sessionsById, workspaces, null), null);

  const empty = docOf([{ ...group('g1'), sessionIds: [] }]);
  assert.equal(inferWorkspaceId(empty, 'g1', sessionsById, workspaces, 'b1'), 'wb');
  assert.equal(inferWorkspaceId(empty, 'g1', sessionsById, workspaces, null), null);

  assert.equal(inferWorkspaceId(empty, null, sessionsById, workspaces, 'a2'), 'wa', 'ungrouped/new uses current workspace');
});

test('tree building is deterministic and never mutates the input doc', () => {
  const doc = docOf([{ ...group('g1'), sessionIds: ['s1'] }], ['s2']);
  const sessions = { s1: session('s1'), s2: session('s2') };
  const snapshot = JSON.stringify(doc);
  const first = buildRenderTree(doc, sessions, [], { filter: 'hidden' });
  const second = buildRenderTree(doc, sessions, [], { filter: 'hidden' });
  assert.deepEqual(first, second, 'same input -> same output (U15)');
  assert.equal(JSON.stringify(doc), snapshot, 'buildRenderTree must be pure');
});

test('group name boundary: 80 chars accepted, 81 rejected, whitespace trimmed', () => {
  const doc = emptyDoc();
  const atLimit = createGroup(doc, { name: 'x'.repeat(80) });
  assert.equal(atLimit.groups[0].name.length, 80);
  assert.throws(() => createGroup(doc, { name: 'x'.repeat(81) }), /name/i);
  const trimmed = createGroup(doc, { name: '  施工中  ' });
  assert.equal(trimmed.groups[0].name, '施工中');
  assert.throws(() => createGroup(doc, { name: '   ' }), /name/i);
});

test('moveGroup: cross-parent move preserves sibling order, subtree follows, doc immutable', () => {
  const doc = docOf([
    { ...group('a'), sessionIds: ['s1'] },
    { ...group('b'), sessionIds: ['s2'] },
    { ...group('child', 'a'), sessionIds: ['s3'] },
    group('sibling'),
  ]);
  const snapshot = JSON.stringify(doc);
  const moved = moveGroup(doc, 'child', null, 1);
  assert.deepEqual(moved.groups.filter((item) => item.parentId === null).map((item) => item.id), ['a', 'child', 'b', 'sibling']);
  assert.equal(moved.groups.find((item) => item.id === 'child').sessionIds.includes('s3'), true, 'subtree content follows the group');
  assert.equal(JSON.stringify(doc), snapshot, 'moveGroup returns a new doc');
  assert.throws(() => moveGroup(doc, 'a', 'child'), /cycle/);
});

test('assignSession: cross-group move never duplicates; index clamps; groupId null ungroups', () => {
  const doc = docOf([{ ...group('a'), sessionIds: ['s1'] }, { ...group('b'), sessionIds: ['s2', 's3'] }], ['u1']);
  const toB = assignSession(doc, 's1', 'b', 99);
  assert.deepEqual(toB.groups[1].sessionIds, ['s2', 's3', 's1'], 'index clamps to append');
  assert.deepEqual(toB.groups[0].sessionIds, [], 'removed from previous group');
  assert.equal(toB.ungrouped.includes('s1'), false, 'no duplicate across group/ungrouped');

  const toUngrouped = assignSession(doc, 's2', null, -5);
  assert.deepEqual(toUngrouped.ungrouped, ['s2', 'u1'], 'negative index clamps to head');
  assert.deepEqual(toUngrouped.groups[1].sessionIds, ['s3']);
});

test('removeSession / deleteGroup are non-destructive and idempotent', () => {
  const doc = docOf([{ ...group('a'), sessionIds: ['s1', 's2'] }]);
  const removed = removeSession(doc, 'missing');
  assert.deepEqual(removed, doc, 'removing an absent session is a no-op');
  const twice = removeSession(removeSession(doc, 's1'), 's1');
  assert.deepEqual(twice.groups[0].sessionIds, ['s2']);

  const deleted = deleteGroup(docOf([group('a'), { ...group('child', 'a') }]), 'a');
  assert.equal(deleted.groups.find((item) => item.id === 'child').parentId, null, 'children promoted to root');
  const withSessions = deleteGroup(docOf([{ ...group('withSessions'), sessionIds: ['s1'] }]), 'withSessions');
  assert.deepEqual(withSessions.ungrouped, ['s1'], 'deleted group sessions move to ungrouped head, never archived/deleted');
});

test('validateDoc taxonomy: version/revision/duplicates/cycles/missing parents/depth', () => {
  assert.deepEqual(validateDoc(null), { ok: false, errors: ['doc-not-object'] });
  const base = emptyDoc();
  const cases = [
    [{ ...base, version: 2 }, /version/],
    [{ ...base, revision: -1 }, /revision/],
    [docOf([{ ...group('g1'), sessionIds: ['s1'] }], ['s1']), /duplicate-session:s1/],
    [docOf([{ ...group('g1'), parentId: 'missing' }]), /missing-parent:g1/],
    [docOf([{ ...group('a', 'b') }, { ...group('b', 'a') }]), /cycle/],
  ];
  for (const [doc, pattern] of cases) {
    const result = validateDoc(doc);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(';'), pattern);
  }
  assert.equal(validateDoc(emptyDoc()).ok, true);
});

test('normalizeDoc: repairs duplicate ids, missing parents and over-long names (server-side tolerance)', () => {
  const raw = {
    version: 1,
    revision: 3,
    groups: [
      { id: 'g1', name: 'a'.repeat(120), icon: 'folder', parentId: 'missing', sessionIds: [] },
      { id: 'g1', name: 'dupe', icon: 'folder', parentId: null, sessionIds: [] },
      { id: 'g2', name: '  ', icon: 'not-an-icon', parentId: null, sessionIds: [] },
    ],
    ungrouped: ['s1', 's1'],
  };
  const normalized = normalizeDoc(raw);
  assert.equal(normalized.groups.length, 2);
  assert.equal(normalized.groups[0].name.length, 80);
  assert.equal(normalized.groups[0].parentId, null);
  assert.equal(normalized.groups[1].name, '未命名');
  assert.deepEqual(normalized.ungrouped, ['s1']);
  assert.equal(validateDoc(normalized).ok, true);
});

test('cloneDoc deep-copies (callers cannot mutate a returned doc through nested arrays)', () => {
  const doc = docOf([{ ...group('g1'), sessionIds: ['s1'] }], ['s2']);
  const copy = cloneDoc(doc);
  copy.groups[0].sessionIds.push('s3');
  copy.ungrouped.push('s4');
  copy.groups[0].name = 'changed';
  assert.deepEqual(doc.groups[0].sessionIds, ['s1']);
  assert.deepEqual(doc.ungrouped, ['s2']);
  assert.equal(doc.groups[0].name, 'g1');
});

