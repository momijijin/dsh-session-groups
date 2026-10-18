// tests/integration/host-routes.test.js
//
// V1 host integration - TEST-PLAN §3 (H1-H10) plus the frozen wire contract
// (docs/CONTRACTS.md §2). The routes are exercised through their real handlers
// with a fake ctx; the store writes into a throw-away temp directory.
//
// Skips itself until src/host lands (task-4); then activates automatically.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  COMMIT_PATH,
  GROUP_FILE_NAME,
  LOAD_PATH,
  createHarness,
  createTestStore,
  hostReady,
  listDirFiles,
  makeFakeHome,
  makeTempDir,
  readJsonFile,
  skipReason,
  validDoc,
  validDocWithGroup,
  writeJsonFile,
} from './helpers.js';

const skip = hostReady() ? false : skipReason('src/host routes/store/fence');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fileSha = (path) => sha256(readFileSync(path));

async function setupHarness(options = {}) {
  const tmp = makeTempDir();
  const store = await createTestStore(tmp.dir);
  const harness = await createHarness({ store, ...options });
  return { tmp, store, harness };
}

test('H1: first load without a file returns the empty document at revision 0', { skip }, async (t) => {
  const { tmp, harness } = await setupHarness();
  t.after(() => tmp.cleanup());

  const response = await harness.invoke(LOAD_PATH, { method: 'GET' });
  assert.equal(response.status, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.revision, 0);
  assert.deepEqual(body.doc, { version: 1, revision: 0, groups: [], ungrouped: [] });
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(response.headers['access-control-allow-origin'], undefined, 'no CORS headers');
  assert.equal(existsSync(tmp.filePath), false, 'load must not create the record file');
});

test('H2: commit writes the file and bumps the revision', { skip }, async (t) => {
  const { tmp, harness } = await setupHarness();
  t.after(() => tmp.cleanup());

  const doc = validDocWithGroup();
  const response = await harness.invoke(COMMIT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRevision: 0, doc }),
  });
  assert.equal(response.status, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.revision, 1);
  assert.deepEqual(body.doc.groups, doc.groups);
  assert.deepEqual(body.doc.ungrouped, doc.ungrouped);

  assert.equal(existsSync(tmp.filePath), true);
  const onDisk = readJsonFile(tmp.filePath);
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.revision, 1);
  assert.deepEqual(onDisk.groups, doc.groups);

  const reload = await harness.invoke(LOAD_PATH, { method: 'GET' });
  assert.equal(reload.json().revision, 1, 'load sees the committed revision');
});

test('H3: stale baseRevision returns 409 with the current doc and does not overwrite', { skip }, async (t) => {
  const { tmp, harness } = await setupHarness();
  t.after(() => tmp.cleanup());

  const first = await harness.invoke(COMMIT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRevision: 0, doc: validDocWithGroup() }),
  });
  assert.equal(first.status, 200);
  const revision = first.json().revision;
  const before = fileSha(tmp.filePath);

  const stale = await harness.invoke(COMMIT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRevision: revision - 1, doc: validDoc({ groups: [] }) }),
  });
  assert.equal(stale.status, 409);
  const body = stale.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, 'conflict');
  assert.equal(body.revision, revision);
  assert.ok(Array.isArray(body.doc.groups), '409 returns the current doc');
  assert.equal(fileSha(tmp.filePath), before, 'stale commit must not overwrite the file');
});

test('H4: invalid document returns 422 and leaves the file untouched', { skip }, async (t) => {
  const { tmp, harness } = await setupHarness();
  t.after(() => tmp.cleanup());

  await harness.invoke(COMMIT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRevision: 0, doc: validDocWithGroup() }),
  });
  const before = fileSha(tmp.filePath);

  const invalidDoc = validDoc({
    groups: [{ id: 'g-0123456789ab', name: 'x', icon: 'folder', parentId: null, sessionIds: ['dup'] }],
    ungrouped: ['dup'],
  });
  const response = await harness.invoke(COMMIT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRevision: 1, doc: invalidDoc }),
  });
  assert.equal(response.status, 422);
  const body = response.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, 'invalid');
  assert.equal(fileSha(tmp.filePath), before, 'invalid commit must not write the file');
});

test('H5: atomic write leaves no tmp file and keeps one .bak', { skip }, async (t) => {
  const { tmp, harness } = await setupHarness();
  t.after(() => tmp.cleanup());

  const commit = (baseRevision, doc) => harness.invoke(COMMIT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRevision, doc }),
  });
  assert.equal((await commit(0, validDocWithGroup())).status, 200);
  assert.equal((await commit(1, validDocWithGroup())).status, 200);

  const names = listDirFiles(tmp.dir);
  assert.ok(names.includes(GROUP_FILE_NAME), `record file missing: ${names.join(', ')}`);
  assert.ok(names.includes(`${GROUP_FILE_NAME}.bak`), `expected ${GROUP_FILE_NAME}.bak, got ${names.join(', ')}`);
  assert.deepEqual(names.filter((name) => name.endsWith('.tmp')), [], 'no temporary files may remain');
  assert.equal(statSync(tmp.filePath).size > 0, true);
});

test('H6: corrupt JSON is quarantined and load degrades to an empty doc with a warning', { skip }, async (t) => {
  const { tmp, harness } = await setupHarness();
  t.after(() => tmp.cleanup());

  writeFileSync(tmp.filePath, '{ this is not json', 'utf8');
  const response = await harness.invoke(LOAD_PATH, { method: 'GET' });
  assert.equal(response.status, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.revision, 0);
  assert.deepEqual(body.doc, { version: 1, revision: 0, groups: [], ungrouped: [] });
  assert.equal(body.warning, 'corrupt-file');

  const quarantined = listDirFiles(tmp.dir).filter((name) => /\.corrupt-/.test(name));
  assert.equal(quarantined.length >= 1, true, `expected a .corrupt-* quarantine file, got ${listDirFiles(tmp.dir).join(', ')}`);
  assert.equal(existsSync(tmp.filePath), false, 'the corrupt file is moved away, not overwritten');

  // After the corrupt quarantine the first commit writes normally (and a .bak is not required yet).
  const commit = await harness.invoke(COMMIT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRevision: 0, doc: validDocWithGroup() }),
  });
  assert.equal(commit.status, 200);
});

test('H7: a newer document version is rejected and never overwritten', { skip }, async (t) => {
  const { tmp, harness } = await setupHarness();
  t.after(() => tmp.cleanup());

  const future = { version: 2, revision: 7, groups: [], ungrouped: [] };
  writeJsonFile(tmp.filePath, future);
  const before = fileSha(tmp.filePath);

  const load = await harness.invoke(LOAD_PATH, { method: 'GET' });
  assert.equal(load.status, 409);
  const loadBody = load.json();
  assert.equal(loadBody.ok, false);
  assert.equal(loadBody.code, 'unsupported-version');

  const commit = await harness.invoke(COMMIT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRevision: 7, doc: validDocWithGroup() }),
  });
  assert.equal(commit.status, 409);
  assert.equal(commit.json().code, 'unsupported-version');
  assert.equal(fileSha(tmp.filePath), before, 'unsupported-version must not overwrite the file');
});

test('H8: concurrent commits are serialized (one 200, one 409 conflict)', { skip }, async (t) => {
  const { tmp, harness } = await setupHarness();
  t.after(() => tmp.cleanup());

  const commit = (doc) => harness.invoke(COMMIT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRevision: 0, doc }),
  });
  const [a, b] = await Promise.all([commit(validDocWithGroup()), commit(validDocWithGroup())]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409], 'one commit wins, the other sees the stale revision');
  const winner = a.status === 200 ? a : b;
  assert.equal(winner.json().revision, 1);
  assert.equal(readJsonFile(tmp.filePath).revision, 1);
});

test('H9: fence contract - missing fence fails closed 503, rejection propagates, throw fails closed', { skip }, async (t) => {
  const tmp = makeTempDir();
  t.after(() => tmp.cleanup());
  const store = await createTestStore(tmp.dir);

  const missing = await createHarness({ store, fence: 'missing' });
  const closed = await missing.invoke(LOAD_PATH, { method: 'GET' });
  assert.equal(closed.status, 503);
  assert.equal(closed.json().code, 'fence-unavailable');

  const rejecting = await createHarness({ store, fence: 'reject' });
  const denied = await rejecting.invoke(LOAD_PATH, { method: 'GET' });
  assert.equal(denied.status, 403);

  const throwing = await createHarness({ store, fence: 'throw' });
  const failedClosed = await throwing.invoke(LOAD_PATH, { method: 'GET' });
  assert.equal(failedClosed.status, 403, 'a throwing fence must fail closed');
});

test('H10: a commit only writes the record file (workspace.json / session logs untouched)', { skip }, async (t) => {
  const home = makeFakeHome();
  t.after(() => home.cleanup());

  const workspacePath = join(home.storages, 'workspace.json');
  const sessionPath = join(home.sessions, 'session.v4.jsonl.zstd');
  const workspaceBefore = fileSha(workspacePath);
  const sessionBefore = fileSha(sessionPath);

  const store = await createTestStore(home.storages);
  const harness = await createHarness({ store });
  const commit = await harness.invoke(COMMIT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRevision: 0, doc: validDocWithGroup() }),
  });
  assert.equal(commit.status, 200);

  assert.equal(fileSha(workspacePath), workspaceBefore, 'workspace.json must not change');
  assert.equal(fileSha(sessionPath), sessionBefore, 'session logs must not change');
  assert.equal(existsSync(join(home.storages, GROUP_FILE_NAME)), true);
  const leftovers = readdirSync(home.storages).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], 'no tmp files may remain in storages/');
});

test('contract: method / content-type / body-limit / malformed-body status codes', { skip }, async (t) => {
  const { tmp, harness } = await setupHarness();
  t.after(() => tmp.cleanup());

  const postLoad = await harness.invoke(LOAD_PATH, { method: 'POST' });
  assert.equal(postLoad.status, 405);
  assert.equal(postLoad.headers['allow'], 'GET');

  const getCommit = await harness.invoke(COMMIT_PATH, { method: 'GET' });
  assert.equal(getCommit.status, 405);
  assert.equal(getCommit.headers['allow'], 'POST');

  const wrongType = await harness.invoke(COMMIT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ baseRevision: 0, doc: validDoc() }),
  });
  assert.equal(wrongType.status, 415);

  const tooLarge = await harness.invoke(COMMIT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'x'.repeat(300 * 1024),
  });
  assert.equal(tooLarge.status, 413);

  const malformed = await harness.invoke(COMMIT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{ not json',
  });
  assert.equal(malformed.status, 422);
  assert.equal(malformed.json().code, 'invalid');
});
