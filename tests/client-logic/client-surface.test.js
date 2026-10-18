// tests/client-logic/client-surface.test.js
//
// V1 QA - cross-cutting client-logic checks that complement (not duplicate) the
// implementation-owned tests. The V1 client is built in parallel (task-5), so each
// test discovers the module surface at runtime and skips with a diagnostic when a
// module is not there yet. Contract anchors: docs/CONTRACTS.md §4/§4.1,
// docs/TEST-PLAN.md §4 (C1-C10).

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from '../integration/helpers.js';

const clientDir = join(REPO_ROOT, 'src', 'client');
const modulePath = (name) => join(clientDir, name);
const has = (name) => existsSync(modulePath(name));

async function importClient(name) {
  return await import(new URL(`../../src/client/${name}`, import.meta.url).href);
}

function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test('state: view mode defaults to workspace, persists groups, and stays at the contract key', async (t) => {
  if (!has('state.js')) { t.skip('src/client/state.js not implemented yet (task-5)'); return; }
  const module = await importClient('state.js');
  const read = module.readViewMode ?? module.getViewMode;
  const write = module.writeViewMode ?? module.setViewMode;
  if (typeof read !== 'function' || typeof write !== 'function') { t.skip('state.js exposes no viewMode read/write'); return; }
  const storage = fakeStorage();
  assert.equal(read(storage), 'workspace', 'first install defaults to the official workspace view');
  write('groups', storage);
  assert.equal(read(storage), 'groups');
  assert.equal(storage.map.has(module.VIEW_MODE_KEY ?? 'dsh-session-groups.view.v1'), true);
  write('bogus', storage);
  assert.equal(read(storage), 'workspace', 'unknown persisted values fall back to workspace');

  const filterRead = module.readArchiveFilter;
  const filterWrite = module.writeArchiveFilter;
  if (typeof filterRead === 'function' && typeof filterWrite === 'function') {
    assert.equal(filterRead(storage), 'hidden', 'archive filter defaults to hidden');
    filterWrite('only', storage);
    assert.equal(filterRead(storage), 'only');
  }
});

test('filter: buildVisibleTree honours the archive tri-state and never drops groups (C1/C2)', async (t) => {
  if (!has('filter.js')) { t.skip('src/client/filter.js not implemented yet (task-5)'); return; }
  const module = await importClient('filter.js');
  const build = module.buildVisibleTree;
  assert.equal(typeof build, 'function', 'filter.js must export buildVisibleTree');
  const { emptyDoc, createGroup, assignSession } = await import('../../src/shared/model.js');
  let doc = createGroup(emptyDoc(), { name: '组A' });
  const groupId = doc.groups[0].id;
  doc = assignSession(doc, 'live', groupId);
  doc = assignSession(doc, 'archived', groupId);
  doc = assignSession(doc, 'blankOther', null);
  const sessionsById = {
    live: { id: 'live', title: 'live', updatedAt: 2 },
    archived: { id: 'archived', title: 'archived', updatedAt: 3 },
    blankOther: { id: 'blankOther', title: 'blank', updatedAt: 1, blank: true },
  };
  const base = { archivedSessionIds: ['archived'], currentSessionId: null, statuses: new Map() };

  const hidden = build(doc, sessionsById, [], { ...base, filter: 'hidden' });
  assert.equal(hidden.groups.length, 1, 'groups always stay visible');
  assert.equal(hidden.groups[0].visibleCount, 1);
  assert.deepEqual(hidden.groups[0].children.filter((node) => node.kind === 'session').map((node) => node.session.id), ['live']);

  const all = build(doc, sessionsById, [], { ...base, filter: 'all' });
  assert.equal(all.groups[0].visibleCount, 2);
  const archivedNode = all.groups[0].children.find((node) => node.kind === 'session' && node.session.id === 'archived');
  assert.equal(archivedNode.archived, true, 'archived rows are muted in "all"');

  const only = build(doc, sessionsById, [], { ...base, filter: 'only' });
  assert.deepEqual(only.groups[0].children.filter((node) => node.kind === 'session').map((node) => node.session.id), ['archived']);
});

test('drag: hitTest maps geometry to before/after/append/ungrouped/invalid; applyDrop mutates doc (C3/C4)', async (t) => {
  if (!has('drag.js')) { t.skip('src/client/drag.js not implemented yet (task-5)'); return; }
  const module = await importClient('drag.js');
  const { hitTest, applyDrop } = module;
  assert.equal(typeof hitTest, 'function');
  assert.equal(typeof applyDrop, 'function');

  const source = { kind: 'session', sessionId: 's1' };
  const row = { rowKind: 'session', rowTop: 100, rowHeight: 30, targetGroupId: 'g1', targetSessionId: 's2' };
  assert.equal(hitTest({ source, pointerY: 105, ...row }).kind, 'session-before');
  assert.equal(hitTest({ source, pointerY: 125, ...row }).kind, 'session-after');
  assert.equal(hitTest({ source, rowKind: 'group', pointerY: 10, rowTop: 0, rowHeight: 24, targetGroupId: 'g1' }).kind, 'group-append');
  assert.equal(hitTest({ source, rowKind: 'ungrouped', pointerY: 10, rowTop: 0, rowHeight: 24 }).kind, 'ungrouped');
  assert.equal(hitTest({ source, pointerY: 105, ...row, targetSessionId: 's1' }).kind, 'invalid', 'self-drop is invalid');
  assert.equal(hitTest({ source, rowKind: 'blank', pointerY: 10, rowTop: 0, rowHeight: 24 }).kind, 'invalid');

  const { emptyDoc, createGroup, assignSession } = await import('../../src/shared/model.js');
  let doc = createGroup(emptyDoc(), { name: '组A' });
  const gid = doc.groups[0].id;
  doc = assignSession(doc, 's1', gid);
  doc = assignSession(doc, 's2', gid);
  // Move s2 before s1 (a real position change inside the same group).
  const sourceS2 = { kind: 'session', sessionId: 's2' };
  const target = hitTest({ source: sourceS2, pointerY: 105, rowKind: 'session', rowTop: 100, rowHeight: 30, targetGroupId: gid, targetSessionId: 's1' });
  assert.equal(target.kind, 'session-before');
  const applied = applyDrop(doc, sourceS2, target);
  assert.equal(applied.applied, true);
  assert.deepEqual(applied.doc.groups[0].sessionIds, ['s2', 's1'], 's2 moved before s1 inside the same group');
  const noop = applyDrop(applied.doc, sourceS2, target);
  assert.equal(noop.applied, false, 'dropping an element onto its current position is a no-op');
});

test('tree: expansion helpers expose ancestors, path and flattened order (C5/C6 helpers)', async (t) => {
  if (!has('tree.js')) { t.skip('src/client/tree.js not implemented yet (task-5)'); return; }
  const module = await importClient('tree.js');
  const { emptyDoc, createGroup } = await import('../../src/shared/model.js');
  let doc = createGroup(emptyDoc(), { name: '根' });
  doc = createGroup(doc, { name: '子', parentId: doc.groups[0].id });
  const rootId = doc.groups[0].id;
  const childId = doc.groups[1].id;
  if (typeof module.groupAncestors === 'function') {
    assert.deepEqual(module.groupAncestors(doc, childId), [rootId], 'ancestors are returned root-first');
  }
  if (typeof module.groupPath === 'function') {
    assert.equal(module.groupPath(doc, childId), '根 / 子');
  }
  const tree = (await import('../../src/shared/model.js')).buildRenderTree(doc, {}, [], {});
  if (typeof module.flattenTree === 'function') {
    const flat = module.flattenTree(tree, {});
    assert.deepEqual(flat.filter((row) => row.kind === 'group').map((row) => row.node.group.id), [rootId, childId]);
    const collapsedFlat = module.flattenTree(tree, { [rootId]: true });
    assert.deepEqual(collapsedFlat.map((row) => row.kind), ['group'], 'a collapsed group renders only its own header row');
  }
});

test('client bundle source: no removed @deepseek-ai/dsh-client-runtime dependency and react is external', async (t) => {
  if (!has('index.js')) { t.skip('src/client/index.js not implemented yet (task-5)'); return; }
  const { readFile } = await import('node:fs/promises');
  const indexSource = await readFile(modulePath('index.js'), 'utf8');
  assert.equal(indexSource.includes('dsh-client-runtime'), false, 'CONTRACTS §7 forbids @deepseek-ai/dsh-client-runtime');
  assert.equal(indexSource.includes('__ModuleLoader__.load'), true, 'client entry must use window.__ModuleLoader__.load({id, factory})');
  const buildScript = join(REPO_ROOT, 'scripts', 'build-client.mjs');
  if (existsSync(buildScript)) {
    const buildSource = await readFile(buildScript, 'utf8');
    assert.equal(buildSource.includes("'react'") && buildSource.includes("'react/jsx-runtime'"), true,
      'react / react/jsx-runtime must stay external (no second React copy)');
  }
});

test('client: stable data-testid names from CONTRACTS §4.1 are present in the source', async (t) => {
  if (!has('index.js') && !has('components.js')) {
    t.skip('src/client not implemented yet (task-5)');
    return;
  }
  const { readFile } = await import('node:fs/promises');
  const files = [join(clientDir, 'components.js')];
  if (has('index.js')) files.push(join(clientDir, 'index.js'));
  const source = (await Promise.all(files.filter((file) => existsSync(file)).map((file) => readFile(file, 'utf8')))).join('\n');
  for (const testId of [
    'session-groups-toggle',
    'session-groups-view',
    'session-groups-group',
    'session-groups-session',
    'session-groups-ungrouped',
    'session-groups-dialog',
    'session-groups-archive-filter',
    'session-groups-rail',
  ]) {
    assert.equal(source.includes(testId), true, `missing required data-testid "${testId}" (CONTRACTS §4.1)`);
  }
});

