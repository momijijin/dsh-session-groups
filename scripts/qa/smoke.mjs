#!/usr/bin/env node
// scripts/spike/smoke.mjs
//
// Gate 0 QA smoke check for the dsh-session-grove spike.
//
// Deliberately dependency-free: Node 22+/24 provides global fetch and WebSocket,
// and the machine already has a Chromium build (Playwright cache) plus Edge/Chrome.
// The browser half speaks the Chrome DevTools Protocol directly, so the QA harness
// does not add a Playwright/package.json dependency to the repository.
//
// Checks performed:
//   HTTP-1  web UI root answers 200 after the token handshake (401 without token)
//   HTTP-2  HTML is the DSH web app shell (<div id="root"> + __DSH_BOOT__ payload)
//   HTTP-3  GET /dsh-session-grove/load -> 200 {ok:true, revision, doc}
//   HTTP-4  (opt) POST /dsh-session-grove/commit -> 200, revision +1
//   HTTP-5  (opt) commit with a foreign Origin is rejected (fence)
//   UI-1    Chromium loads the page, React root mounts
//   UI-2    boot payload contains the expected plugin marker (client plugin loaded)
//   UI-3    no uncaught page exception
//   UI-4    no plugin/module console error
//   UI-5    (strict) no console error at all
//   UI-6    in-page same-origin fetch of the load route succeeds
//   UI-7    screenshot captured (evidence artifact)
//
// Usage:
//   node scripts/spike/smoke.mjs --evidence-dir scripts/qa/evidence
//   node scripts/spike/smoke.mjs --token-url "http://127.0.0.1:4402/?token=..." --browser none
//
// Exit codes: 0 = PASS, 1 = FAIL, 2 = harness error.

import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {
    baseUrl: null,
    tokenUrl: null,
    webState: null,
    loadPath: '/dsh-session-grove/load',
    commitPath: '/dsh-session-grove/commit',
    browser: 'auto',
    expectBootContains: [],
    expectSelector: null,
    expectText: null,
    timeoutMs: 90000,
    settleMs: 4000,
    evidenceDir: null,
    allowConsoleError: [],
    strictConsole: false,
    strictNetwork: false,
    commitProbe: false,
    fenceProbe: false,
    screenshot: null,
    repoRoot: resolve(__dirname, '..', '..'),
  };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    const need = (name) => {
      if (val === undefined || val.startsWith('--')) throw new Error(`${name} needs a value`);
      i++;
      return val;
    };
    switch (key) {
      case '--base-url': args.baseUrl = need(key); break;
      case '--token-url': args.tokenUrl = need(key); break;
      case '--web-state': args.webState = need(key); break;
      case '--load-path': args.loadPath = need(key); break;
      case '--commit-path': args.commitPath = need(key); break;
      case '--browser': args.browser = need(key); break;
      case '--expect-boot-contains': args.expectBootContains.push(need(key)); break;
      case '--expect-selector': args.expectSelector = need(key); break;
      case '--expect-text': args.expectText = need(key); break;
      case '--timeout-ms': args.timeoutMs = Number(need(key)); break;
      case '--settle-ms': args.settleMs = Number(need(key)); break;
      case '--evidence-dir': args.evidenceDir = need(key); break;
      case '--allow-console-error': args.allowConsoleError.push(need(key)); break;
      case '--strict-console': args.strictConsole = true; break;
      case '--strict-network': args.strictNetwork = true; break;
      case '--commit-probe': args.commitProbe = true; break;
      case '--fence-probe': args.fenceProbe = true; break;
      case '--screenshot': args.screenshot = need(key); break;
      case '--repo-root': args.repoRoot = need(key); break;
      default: throw new Error(`unknown argument: ${key}`);
    }
  }
  if (!args.evidenceDir) {
    args.evidenceDir = join(args.repoRoot, 'spike', 'qa', 'evidence');
  }
  if (!args.baseUrl) args.baseUrl = 'http://127.0.0.1:4402/';
  return args;
}

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const timestamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const redact = (text) => (text ? String(text).replace(/token=[^&\s"']+/g, 'token=***') : text);

const checks = [];
function addCheck(id, description, pass, detail) {
  checks.push({ id, description, pass: !!pass, detail: detail == null ? null : String(detail) });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${id} - ${description}`);
  if (detail) console.log(`         ${detail}`);
}

function parseWebState(statePath) {
  if (!statePath || !existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

async function getFreePort() {
  return await new Promise((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => res(port));
    });
  });
}

function cookieFromSetCookie(headers) {
  let raw = [];
  if (typeof headers.getSetCookie === 'function') raw = headers.getSetCookie();
  else if (headers.get('set-cookie')) raw = [headers.get('set-cookie')];
  if (!raw || raw.length === 0) return null;
  const first = raw[0].split(';')[0].trim();
  return first.includes('=') ? first : null;
}

// ---------------------------------------------------------------------------
// HTTP checks
// ---------------------------------------------------------------------------
async function httpChecks(args, evidence) {
  const result = { tokenUrlRedacted: redact(args.tokenUrl), baseUrl: args.baseUrl, requests: [] };
  const base = args.baseUrl.endsWith('/') ? args.baseUrl : args.baseUrl + '/';
  const tokenUrl = args.tokenUrl;

  // HTTP-1: without token the root must be fenced (401) when a token URL is known.
  if (tokenUrl) {
    try {
      const fenced = await fetch(base, { redirect: 'manual' });
      result.fenceStatus = fenced.status;
      addCheck('HTTP-1a', 'unauthenticated GET / is rejected (401)', fenced.status === 401, `status=${fenced.status}`);
    } catch (error) {
      addCheck('HTTP-1a', 'unauthenticated GET / is rejected (401)', false, String(error));
    }
  }

  // Token handshake: GET token URL without redirect-following, capture auth cookie.
  let cookie = null;
  let rootResponse = null;
  if (tokenUrl) {
    try {
      const handshake = await fetch(tokenUrl, { redirect: 'manual' });
      cookie = cookieFromSetCookie(handshake.headers);
      result.handshakeStatus = handshake.status;
      const location = handshake.headers.get('location');
      result.handshakeLocation = location;
      const target = location ? new URL(location, tokenUrl).toString() : base;
      rootResponse = await fetch(target, { redirect: 'manual', headers: cookie ? { cookie } : {} });
      result.requests.push({ kind: 'token-handshake', status: handshake.status, location });
    } catch (error) {
      addCheck('HTTP-1b', 'token handshake reaches the web UI', false, String(error));
    }
  }
  if (!rootResponse) {
    try {
      rootResponse = await fetch(base, { redirect: 'manual', headers: cookie ? { cookie } : {} });
    } catch (error) {
      addCheck('HTTP-1b', 'web UI root answers', false, String(error));
      return result;
    }
  }
  const html = rootResponse.status === 200 ? await rootResponse.text() : '';
  const hasRootDiv = html.includes('<div id="root">');
  const hasBoot = html.includes('__DSH_BOOT__');
  result.rootStatus = rootResponse.status;
  result.rootBytes = html.length;
  result.hasRootDiv = hasRootDiv;
  result.hasBoot = hasBoot;
  addCheck('HTTP-1b', 'web UI root answers 200 after the token handshake', rootResponse.status === 200,
    `status=${rootResponse.status}; bytes=${html.length}; cookie=${cookie ? 'yes' : 'no'}; tokenUrl=${redact(tokenUrl) || '(none)'}`);
  addCheck('HTTP-2', 'HTML is the DSH web app shell (root div + boot payload)', rootResponse.status === 200 && hasRootDiv && hasBoot,
    `root-div=${hasRootDiv}; __DSH_BOOT__=${hasBoot}`);
  if (rootResponse.status !== 200) return result;

  const authHeaders = cookie ? { cookie } : {};

  // HTTP-3: load route.
  let loaded = null;
  const loadUrl = base + args.loadPath.replace(/^\//, '');
  try {
    const loadResponse = await fetch(loadUrl, { headers: authHeaders });
    const bodyText = await loadResponse.text();
    result.loadStatus = loadResponse.status;
    result.loadBody = bodyText.slice(0, 1000);
    try { loaded = JSON.parse(bodyText); } catch { loaded = null; }
    const shapeOk = loaded && loaded.ok === true && loaded.revision != null && loaded.doc &&
      loaded.doc.version === 1 && Array.isArray(loaded.doc.groups) && Array.isArray(loaded.doc.ungrouped);
    addCheck('HTTP-3', 'GET /dsh-session-grove/load returns 200 {ok:true, revision, doc}', loadResponse.status === 200 && shapeOk,
      `status=${loadResponse.status}; revision=${loaded ? loaded.revision : 'n/a'}; body=${bodyText.slice(0, 240)}`);
  } catch (error) {
    addCheck('HTTP-3', 'GET /dsh-session-grove/load returns 200 {ok:true, revision, doc}', false, String(error));
  }

  // HTTP-4: optional commit probe (mutates the plugin record file - QA only).
  if (args.commitProbe && loaded) {
    const commitUrl = base + args.commitPath.replace(/^\//, '');
    try {
      const payload = JSON.stringify({ baseRevision: loaded.revision, doc: loaded.doc });
      const commitResponse = await fetch(commitUrl, {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: payload,
      });
      const commitText = await commitResponse.text();
      let commitJson = null;
      try { commitJson = JSON.parse(commitText); } catch { }
      const revisionOk = commitJson && typeof commitJson.revision === 'number' && commitJson.revision > loaded.revision;
      addCheck('HTTP-4', 'POST /dsh-session-grove/commit (no-op probe) returns 200 and bumps revision',
        commitResponse.status === 200 && revisionOk,
        `status=${commitResponse.status}; revision ${loaded.revision} -> ${commitJson ? commitJson.revision : 'n/a'}; body=${commitText.slice(0, 200)}`);
    } catch (error) {
      addCheck('HTTP-4', 'POST /dsh-session-grove/commit (no-op probe) returns 200 and bumps revision', false, String(error));
    }
  }

  // HTTP-5: optional fence probe - foreign Origin must be rejected.
  if (args.fenceProbe) {
    const commitUrl = base + args.commitPath.replace(/^\//, '');
    try {
      const fencedResponse = await fetch(commitUrl, {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json', origin: 'http://evil.invalid' },
        body: JSON.stringify({ baseRevision: 0, doc: { version: 1, revision: 0, groups: [], ungrouped: [] } }),
      });
      addCheck('HTTP-5', 'commit with foreign Origin is rejected by the request fence',
        fencedResponse.status >= 400 && fencedResponse.status < 500,
        `status=${fencedResponse.status} (expected 4xx)`);
    } catch (error) {
      addCheck('HTTP-5', 'commit with foreign Origin is rejected by the request fence', false, String(error));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// CDP client (zero dependencies)
// ---------------------------------------------------------------------------
class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
  }
  connect(timeoutMs = 20000) {
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP connect timeout: ${this.wsUrl}`)), timeoutMs);
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolvePromise(this);
      });
      this.ws.addEventListener('error', (event) => {
        clearTimeout(timer);
        reject(new Error(`CDP websocket error: ${event?.message || 'unknown'}`));
      });
      this.ws.addEventListener('close', () => {
        this.closed = true;
        for (const { reject: rejectPending } of this.pending.values()) {
          rejectPending(new Error('CDP connection closed'));
        }
        this.pending.clear();
      });
      this.ws.addEventListener('message', (event) => {
        let message;
        try {
          const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
          message = JSON.parse(raw);
        } catch {
          return;
        }
        if (message.id && this.pending.has(message.id)) {
          const { resolve: resolvePending, reject: rejectPending } = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) rejectPending(new Error(`${message.error.message} (${message.error.code})`));
          else resolvePending(message.result);
          return;
        }
        for (const listener of this.listeners) listener(message);
      });
    });
  }
  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      try { this.ws.send(JSON.stringify(payload)); } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  waitForEvent(method, predicate = () => true, timeoutMs = 30000, sessionId = undefined) {
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`timed out waiting for CDP event ${method}`));
      }, timeoutMs);
      const off = this.onEvent((message) => {
        if (message.method !== method) return;
        if (sessionId && message.sessionId !== sessionId) return;
        if (!predicate(message.params)) return;
        clearTimeout(timer);
        off();
        resolvePromise(message.params);
      });
    });
  }
  close() {
    try { this.ws?.close(); } catch { }
  }
}

function findBrowserExecutable(preference) {
  const localAppData = process.env.LOCALAPPDATA || '';
  const edgeCandidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const chromeCandidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  const playwrightCandidates = [];
  if (localAppData) {
    const pwRoot = join(localAppData, 'ms-playwright');
    if (existsSync(pwRoot)) {
      try {
        for (const entry of readdirSync(pwRoot)) {
          if (entry.startsWith('chromium_headless_shell-')) {
            playwrightCandidates.push(join(pwRoot, entry, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'));
          }
          if (entry.startsWith('chromium-')) {
            playwrightCandidates.push(join(pwRoot, entry, 'chrome-win64', 'chrome.exe'));
          }
        }
      } catch { }
    }
  }
  let candidates = [...playwrightCandidates, ...edgeCandidates, ...chromeCandidates];
  if (preference && preference !== 'auto') {
    if (preference === 'edge') candidates = [...edgeCandidates, ...playwrightCandidates, ...chromeCandidates];
    else if (preference === 'chrome') candidates = [...chromeCandidates, ...playwrightCandidates, ...edgeCandidates];
    else if (existsSync(preference)) return preference;
  }
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

async function startBrowser(browserPath) {
  const debugPort = await getFreePort();
  const userDataDir = join(os.tmpdir(), `dsh-gate0-smoke-${process.pid}-${Date.now()}`);
  const name = browserPath.toLowerCase();
  const isHeadlessShell = name.includes('chrome-headless-shell');
  const args = [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-dev-shm-usage',
    '--mute-audio',
    '--hide-scrollbars',
    '--window-size=1440,900',
    'about:blank',
  ];
  if (!isHeadlessShell) args.unshift('--headless=new');
  const child = spawn(browserPath, args, { stdio: 'ignore', windowsHide: true });
  const cleanup = () => {
    try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { }
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { }
  };
  // Wait for the DevTools endpoint.
  const deadline = Date.now() + 25000;
  let versionInfo = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) { versionInfo = await response.json(); break; }
    } catch { }
    await sleep(250);
  }
  if (!versionInfo) {
    cleanup();
    throw new Error(`browser DevTools endpoint did not come up (${browserPath})`);
  }
  return { child, debugPort, userDataDir, versionInfo, cleanup };
}

function remoteObjectText(arg) {
  if (!arg) return '';
  if (arg.value !== undefined) return String(arg.value);
  if (arg.unserializableValue !== undefined) return String(arg.unserializableValue);
  if (arg.description !== undefined) return String(arg.description);
  if (arg.preview && Array.isArray(arg.preview.properties)) {
    return Array.from(arg.preview.properties, (p) => `${p.name}: ${p.value}`).join(', ');
  }
  return arg.type || '';
}

async function browserChecks(args, evidence, tokenUrl) {
  const browserPath = findBrowserExecutable(args.browser);
  if (!browserPath) {
    addCheck('UI-0', 'headless browser available for console-error check', false,
      'no Playwright Chromium / Edge / Chrome found; pass --browser <path> or --browser none');
    return { skipped: false, error: 'no-browser' };
  }
  const browser = await startBrowser(browserPath);
  const result = {
    executable: browserPath,
    product: browser.versionInfo?.Browser || null,
    consoleErrors: [],
    consoleWarnings: [],
    exceptions: [],
    networkFailures: [],
    screenshot: null,
  };
  let cdp = null;
  try {
    cdp = await new CDP(browser.versionInfo.webSocketDebuggerUrl).connect();
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    result.targetId = targetId;

    // Collect console / exception / network events before navigation.
    cdp.onEvent((message) => {
      if (message.sessionId !== sessionId) return;
      const params = message.params || {};
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = (params.args || []).map(remoteObjectText).join(' ');
        const entry = { type: params.type, text, url: params.stackTrace?.callFrames?.[0]?.url || null };
        if (params.type === 'error') result.consoleErrors.push(entry);
        else if (params.type === 'warning' || params.type === 'warn') result.consoleWarnings.push(entry);
      } else if (message.method === 'Runtime.exceptionThrown') {
        const details = params.exceptionDetails || {};
        result.exceptions.push({
          text: details.text || 'uncaught exception',
          description: details.exception?.description || details.exception?.value || null,
          url: details.url || null,
          line: details.lineNumber,
          column: details.columnNumber,
        });
      } else if (message.method === 'Log.entryAdded') {
        const entry = params.entry || {};
        if (entry.level === 'error') {
          result.consoleErrors.push({ type: 'log-entry', text: entry.text || '', url: entry.url || null, source: entry.source || null });
        } else if (entry.level === 'warning') {
          result.consoleWarnings.push({ type: 'log-entry', text: entry.text || '', url: entry.url || null, source: entry.source || null });
        }
      } else if (message.method === 'Network.loadingFailed') {
        if (params.errorText && params.errorText !== 'net::ERR_ABORTED') {
          result.networkFailures.push({ errorText: params.errorText, requestId: params.requestId, type: params.type });
        }
      }
    });

    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Log.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);

    const navUrl = tokenUrl || args.baseUrl;
    result.navigationUrl = redact(navUrl);
    const loaded = cdp.waitForEvent('Page.loadEventFired', () => true, args.timeoutMs, sessionId);
    await cdp.send('Page.navigate', { url: navUrl }, sessionId);
    try { await loaded; } catch (error) { result.loadEventError = String(error); }

    // Wait until the React root is mounted and the boot payload exists.
    const bootDeadline = Date.now() + args.timeoutMs;
    let pageState = null;
    while (Date.now() < bootDeadline) {
      try {
        const evaluation = await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const root = document.querySelector('#root');
            return {
              readyState: document.readyState,
              title: document.title,
              href: location.href,
              rootChildren: root ? root.children.length : -1,
              hasBoot: typeof globalThis.__DSH_BOOT__ !== 'undefined',
              bootBytes: typeof globalThis.__DSH_BOOT__ === 'undefined' ? 0 : JSON.stringify(globalThis.__DSH_BOOT__).length,
              bodyText: (document.body && document.body.innerText || '').slice(0, 400),
            };
          })()`,
          returnByValue: true,
        }, sessionId);
        pageState = evaluation.result?.value || null;
        if (pageState && pageState.rootChildren > 0 && pageState.hasBoot) break;
      } catch { }
      await sleep(300);
    }
    if (!pageState) pageState = {};
    result.page = pageState;
    addCheck('UI-1', 'Chromium loads the web UI and React root mounts',
      (pageState.rootChildren || 0) > 0,
      `title=${JSON.stringify(pageState.title || '')}; rootChildren=${pageState.rootChildren}; readyState=${pageState.readyState}; boot=${pageState.hasBoot}`);

    // Wait a moment for late client-plugin errors to surface, then evaluate markers.
    await sleep(args.settleMs);

    const markers = [];
    const evaluate = async (expression) => {
      const evaluation = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
      return evaluation.result?.value;
    };
    result.expectedBootContains = args.expectBootContains;
    try {
      const bootText = await evaluate('JSON.stringify(globalThis.__DSH_BOOT__ || null)');
      result.bootPayloadBytes = bootText ? bootText.length : 0;
      for (const marker of args.expectBootContains) {
        const present = typeof bootText === 'string' && bootText.includes(marker);
        markers.push({ marker, present });
      }
    } catch (error) {
      result.bootPayloadError = String(error);
    }
    const markerOk = args.expectBootContains.length === 0 || markers.every((m) => m.present);
    addCheck('UI-2', 'boot payload contains expected plugin marker (client plugin loaded)', markerOk,
      args.expectBootContains.length === 0 ? 'no marker requested' : JSON.stringify(markers));

    if (args.expectSelector) {
      const found = await evaluate(`!!document.querySelector(${JSON.stringify(args.expectSelector)})`);
      result.expectSelector = { selector: args.expectSelector, found: !!found };
      addCheck('UI-2b', `expected selector is rendered: ${args.expectSelector}`, !!found, `found=${!!found}`);
    }
    if (args.expectText) {
      const pageText = await evaluate('(document.body && document.body.innerText || "")');
      const found = typeof pageText === 'string' && pageText.includes(args.expectText);
      result.expectText = { text: args.expectText, found };
      addCheck('UI-2c', `expected text is rendered: ${args.expectText}`, found, `found=${found}`);
    }

    // UI-3/UI-4/UI-5: exception and console-error classification.
    addCheck('UI-3', 'no uncaught page exception', result.exceptions.length === 0,
      result.exceptions.length ? JSON.stringify(result.exceptions.slice(0, 5)) : 'none');
    const pluginErrorPattern = /dsh-session-grove|session-groups|Failed to (load|fetch)[^]*?(module|client)|Cannot find module|ERR_MODULE_NOT_FOUND|module resolution|Uncaught/i;
    const pluginErrors = result.consoleErrors.filter((entry) => pluginErrorPattern.test(entry.text || ''));
    result.pluginErrors = pluginErrors;
    addCheck('UI-4', 'no plugin/module console error', pluginErrors.length === 0,
      pluginErrors.length ? JSON.stringify(pluginErrors.slice(0, 5)) : `consoleErrors=${result.consoleErrors.length}`);
    const allowPatterns = args.allowConsoleError.map((pattern) => new RegExp(pattern));
    const unexpectedErrors = result.consoleErrors.filter((entry) =>
      !allowPatterns.some((pattern) => pattern.test(entry.text || '')));
    result.allowConsoleErrors = args.allowConsoleError;
    if (args.strictConsole) {
      addCheck('UI-5', 'no console error at all (strict)', unexpectedErrors.length === 0,
        unexpectedErrors.length ? JSON.stringify(unexpectedErrors.slice(0, 8)) : 'none');
    } else if (unexpectedErrors.length > 0) {
      console.log(`  [WARN] UI-5 ${unexpectedErrors.length} console error(s) not matching plugin patterns (strict mode off):`);
      for (const entry of unexpectedErrors.slice(0, 8)) console.log(`         ${entry.type}: ${entry.text}`);
    }
    if (result.networkFailures.length > 0) {
      const text = JSON.stringify(result.networkFailures.slice(0, 8));
      if (args.strictNetwork) addCheck('UI-5b', 'no failed network request (strict)', false, text);
      else console.log(`  [WARN] network failures (not fatal): ${text}`);
    }

    // UI-6: same-origin fetch from inside the page (client -> host route).
    try {
      const fetchResult = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          const response = await fetch(${JSON.stringify(args.loadPath.replace(/^\//, ''))}, { headers: { accept: 'application/json' } });
          const text = await response.text();
          let ok = false;
          let revision = null;
          try {
            const parsed = JSON.parse(text);
            ok = parsed?.ok === true;
            revision = parsed?.revision ?? null;
          } catch { /* non-JSON body */ }
          return { status: response.status, ok, revision, bodyLength: text.length };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      }, sessionId);
      const value = fetchResult.result?.value || {};
      const ok = value.status === 200 && value.ok === true;
      result.inPageFetch = value;
      addCheck('UI-6', 'in-page same-origin fetch of the load route succeeds', ok,
        `status=${value.status}; ok=${value.ok}; revision=${value.revision}; bytes=${value.bodyLength}`);
    } catch (error) {
      addCheck('UI-6', 'in-page same-origin fetch of the load route succeeds', false, String(error));
    }

    // UI-7: screenshot evidence.
    try {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
      const shotDir = join(args.evidenceDir, 'screenshots');
      mkdirSync(shotDir, { recursive: true });
      const shotPath = args.screenshot || join(shotDir, `smoke-${timestamp()}.png`);
      mkdirSync(dirname(shotPath), { recursive: true });
      writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
      result.screenshot = shotPath;
      addCheck('UI-7', 'screenshot captured as evidence', true, shotPath);
    } catch (error) {
      addCheck('UI-7', 'screenshot captured as evidence', false, String(error));
    }

    // window close
    try { await cdp.send('Target.closeTarget', { targetId }); } catch { }
  } finally {
    try { cdp?.close(); } catch { }
    browser.cleanup();
  }
  return result;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const startedAt = nowIso();
  const args = parseArgs(process.argv);
  mkdirSync(args.evidenceDir, { recursive: true });

  // Resolve token/base URL from web.json when not passed explicitly.
  if (!args.tokenUrl || !args.baseUrl) {
    const state = parseWebState(args.webState || join(args.evidenceDir, 'web.json'));
    if (state) {
      args.tokenUrl = args.tokenUrl || state.url || null;
      args.baseUrl = state.baseUrl || args.baseUrl || (state.port ? `http://127.0.0.1:${state.port}/` : args.baseUrl);
    }
  }
  if (!args.baseUrl) args.baseUrl = 'http://127.0.0.1:4402/';

  console.log('');
  console.log('============================================================');
  console.log(' Gate 0 QA harness - smoke (HTTP + headless browser console)');
  console.log('============================================================');
  console.log(`  baseUrl: ${args.baseUrl}`);
  console.log(`  tokenUrl: ${args.tokenUrl ? redact(args.tokenUrl) : '(none)'}`);

  const evidence = {
    kind: 'gate0-smoke',
    createdAt: startedAt,
    finishedAt: null,
    repoRoot: args.repoRoot,
    baseUrl: args.baseUrl,
    tokenUrl: redact(args.tokenUrl),
    browserMode: args.browser,
    checks: [],
    http: null,
    browser: null,
    result: 'FAIL',
  };

  let exitCode = 0;
  try {
    evidence.http = await httpChecks(args, evidence);
    if (args.browser !== 'none') {
      evidence.browser = await browserChecks(args, evidence, args.tokenUrl);
    } else {
      console.log('  [SKIP] browser checks disabled (-Browser none)');
      evidence.browser = { skipped: true };
    }
  } catch (error) {
    console.error(`SMOKE ERROR: ${error && error.stack ? error.stack : error}`);
    addCheck('SMOKE-ERR', 'smoke completed without harness error', false, String(error && error.message || error));
    exitCode = 2;
  }

  evidence.checks = checks;
  evidence.finishedAt = nowIso();
  const failed = checks.filter((check) => !check.pass);
  evidence.result = failed.length === 0 && exitCode === 0 ? 'PASS' : 'FAIL';
  if (failed.length > 0 && exitCode === 0) exitCode = 1;

  const evidencePath = join(args.evidenceDir, `smoke-${timestamp()}.json`);
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

  console.log('');
  console.log(`=== smoke: ${evidence.result} ===`);
  console.log(`checks: ${checks.length} total, ${checks.length - failed.length} passed, ${failed.length} failed`);
  for (const failure of failed) console.log(`  FAIL ${failure.id}: ${failure.description} ${failure.detail || ''}`);
  console.log(`evidence: ${evidencePath}`);
  if (evidence.browser && evidence.browser.screenshot) console.log(`screenshot: ${evidence.browser.screenshot}`);
  return exitCode;
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  console.error(error);
  process.exitCode = 2;
});



