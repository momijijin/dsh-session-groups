// tests/integration/helpers.js
//
// Shared helpers for the V1 host integration tests.
//
// The tests target the FROZEN wire contract (docs/CONTRACTS.md §2) through the
// plugin's own route handlers: a fake `ctx` registers the routes, and minimal
// Node-like request/response doubles drive them. Store internals are only touched
// through the documented factory shape `createStore({ dir, fileName })`.
//
// Modules are imported lazily and every test file skips itself while the Host
// implementation (src/host) does not exist yet, so `node --test` stays green
// during the parallel V1 build-out and activates automatically once task-4 lands.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GROUP_FILE_NAME = 'dsh-session-groups.json';

export function hostReady() {
  return existsSync(join(REPO_ROOT, 'src', 'host', 'store.js')) &&
    existsSync(join(REPO_ROOT, 'src', 'host', 'routes.js')) &&
    existsSync(join(REPO_ROOT, 'src', 'host', 'fence.js'));
}

export function skipReason(what = 'src/host') {
  return `${what} not implemented yet (task-4); integration test activates automatically when it lands`;
}

export async function importHost(relativePath) {
  return await import(new URL(`../../src/host/${relativePath}`, import.meta.url).href);
}

export async function importIndex() {
  return await import(new URL('../../src/index.js', import.meta.url).href);
}

export function makeTempDir(label = 'dsh-groups-it') {
  const dir = mkdtempSync(join(tmpdir(), `${label}-`));
  return {
    dir,
    filePath: join(dir, GROUP_FILE_NAME),
    cleanup() {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}

/**
 * Adapter over the documented store factory. Frozen CONTRACTS says
 * `createStore({ dir, fileName })`; the Gate 0 spike used `{ filePath }`.
 * Accepting both keeps the integration suite honest about the wire contract
 * without hard-coding one implementation detail.
 */
export async function createTestStore(dir, fileName = GROUP_FILE_NAME) {
  const { createStore } = await importHost('store.js');
  try {
    return createStore({ dir, fileName });
  } catch (error) {
    try {
      return createStore({ filePath: join(dir, fileName) });
    } catch {
      throw error;
    }
  }
}

/** Minimal IncomingMessage double accepted by both Node http and the spike routes. */
export function makeRequest({ method = 'GET', url = '/dsh-session-groups/load', headers = {}, body = null } = {}) {
  const chunks = [];
  if (body !== null && body !== undefined) {
    chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8'));
  }
  const req = {
    method,
    url,
    headers: { host: '127.0.0.1:4402', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
    resume() {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
  return req;
}

/** Minimal ServerResponse double collecting status / headers / body. */
export function makeResponse() {
  const state = { statusCode: 200, headers: {}, chunks: [] };
  const res = {
    get statusCode() { return state.statusCode; },
    set statusCode(value) { state.statusCode = value; },
    headersSent: false,
    setHeader(name, value) { state.headers[String(name).toLowerCase()] = String(value); },
    getHeader(name) { return state.headers[String(name).toLowerCase()]; },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) state.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));
      res.headersSent = true;
    },
    writeHead(statusCode, headers = {}) {
      state.statusCode = statusCode;
      for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    },
    write(chunk) { if (chunk !== undefined) state.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')); },
  };
  return {
    res,
    get status() { return state.statusCode; },
    get headers() { return state.headers; },
    text() { return Buffer.concat(state.chunks).toString('utf8'); },
    json() {
      const text = Buffer.concat(state.chunks).toString('utf8');
      if (text === '') return null;
      try { return JSON.parse(text); } catch { return { __unparsable: text }; }
    },
  };
}

/** Register the routes on a fake ctx and return an invoker. */
export async function createHarness({ store, fence = 'allow', ctxOverrides = {} } = {}) {
  const { registerRoutes } = await importHost('routes.js');
  const routes = new Map();
  const effects = [];
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    webServer: {
      register({ kind, path, handler }) {
        if (kind !== 'exact') throw new Error(`unexpected route kind ${kind}`);
        routes.set(path, handler);
        return () => routes.delete(path);
      },
    },
    effect(factory) {
      const disposer = typeof factory === 'function' ? factory() : factory;
      effects.push(disposer);
      return () => {
        if (typeof disposer === 'function') disposer();
      };
    },
    ...ctxOverrides,
  };
  if (fence === 'allow') {
    ctx.connection = { requestRejection: () => undefined };
  } else if (fence === 'reject') {
    ctx.connection = { requestRejection: () => 403 };
  } else if (fence === 'throw') {
    ctx.connection = { requestRejection: () => { throw new Error('fence exploded'); } };
  } else if (fence === 'missing') {
    // no connection service at all -> routes must fail closed with 503
  }

  const registration = registerRoutes(ctx, store);
  return {
    ctx,
    routes,
    effects,
    registration,
    async invoke(path, options) {
      const handler = routes.get(path);
      if (!handler) throw new Error(`route not registered: ${path}`);
      const req = makeRequest({ url: path, ...options });
      const response = makeResponse();
      await handler(req, response.res);
      return response;
    },
  };
}

export const LOAD_PATH = '/dsh-session-groups/load';
export const COMMIT_PATH = '/dsh-session-groups/commit';

export const validDoc = (overrides = {}) => ({
  version: 1,
  revision: 0,
  groups: [],
  ungrouped: [],
  ...overrides,
});

export const validDocWithGroup = () => ({
  version: 1,
  revision: 0,
  groups: [{ id: 'g-0123456789ab', name: '施工中', icon: 'folder', parentId: null, sessionIds: ['s1'] }],
  ungrouped: ['s2'],
});

export function listDirFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort();
}

export function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJsonFile(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
}

/** Build a minimal isolated DSH-home-like tree for H10 audits. */
export function makeFakeHome() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-home-it-'));
  const storages = join(root, 'storages');
  const sessions = join(root, 'sessions', '--C-Users-it--', 'session-aaaa');
  mkdirSync(storages, { recursive: true });
  mkdirSync(sessions, { recursive: true });
  writeJsonFile(join(storages, 'workspace.json'), {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [], archivedSessionIds: [], pinnedSessionIds: [] },
    tables: { workspaces: {} },
  });
  writeFileSync(join(sessions, 'session.v4.jsonl.zstd'), Buffer.from('fixture-session-log-bytes', 'utf8'));
  return {
    root,
    storages,
    sessions,
    cleanup() { try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } },
  };
}
