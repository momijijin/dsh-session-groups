// e2e/cdp.mjs
//
// Zero-dependency Chrome DevTools Protocol driver for the V1 E2E suite.
// The machine already has a Playwright-managed Chromium build; we launch it
// directly and speak CDP over Node's built-in WebSocket (no npm dependency, and
// no Playwright browser download needed).

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import os from 'node:os';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export function findBrowserExecutable(preference = 'auto') {
  const localAppData = process.env.LOCALAPPDATA || '';
  const playwright = [];
  if (localAppData) {
    const root = join(localAppData, 'ms-playwright');
    if (existsSync(root)) {
      try {
        for (const entry of readdirSync(root)) {
          if (entry.startsWith('chromium_headless_shell-')) {
            playwright.push(join(root, entry, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'));
          }
          if (entry.startsWith('chromium-')) {
            playwright.push(join(root, entry, 'chrome-win64', 'chrome.exe'));
          }
        }
      } catch { /* not present */ }
    }
  }
  const edge = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const chrome = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  let candidates = [...playwright, ...edge, ...chrome];
  if (preference && preference !== 'auto' && existsSync(preference)) return preference;
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
  }

  connect(timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP connect timeout: ${this.wsUrl}`)), timeoutMs);
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(this); });
      this.ws.addEventListener('error', (event) => { clearTimeout(timer); reject(new Error(`CDP websocket error: ${event?.message ?? 'unknown'}`)); });
      this.ws.addEventListener('close', () => {
        for (const { reject: rejectPending } of this.pending.values()) rejectPending(new Error('CDP connection closed'));
        this.pending.clear();
      });
      this.ws.addEventListener('message', (event) => {
        let message;
        try {
          const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
          message = JSON.parse(raw);
        } catch { return; }
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

  send(method, params = {}, sessionId = undefined, timeoutMs = 30000) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const settle = (fn) => (value) => { clearTimeout(timer); fn(value); };
      this.pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
      try { this.ws.send(JSON.stringify(payload)); } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  waitForEvent(method, predicate = () => true, timeoutMs = 30000, sessionId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error(`timed out waiting for ${method}`)); }, timeoutMs);
      const off = this.onEvent((message) => {
        if (message.method !== method) return;
        if (sessionId && message.sessionId !== sessionId) return;
        if (!predicate(message.params)) return;
        clearTimeout(timer);
        off();
        resolve(message.params);
      });
    });
  }

  close() {
    try { this.ws?.close(); } catch { /* already closed */ }
  }
}

/**
 * Launch a headless Chromium with the DevTools endpoint and return a small driver
 * that owns one page target.
 */
export async function launchDriver({ browser: preference = 'auto', timeoutMs = 25000 } = {}) {
  const executable = findBrowserExecutable(preference);
  if (!executable) throw new Error('no Chromium/Edge/Chrome executable found; pass --browser <path>');

  const debugPort = await getFreePort();
  const userDataDir = join(os.tmpdir(), `dsh-e2e-cdp-${process.pid}-${Date.now()}`);
  const isHeadlessShell = executable.toLowerCase().includes('chrome-headless-shell');
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
  const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true });

  const cleanup = () => {
    try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* exited */ }
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* locked */ }
  };

  let versionInfo = null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) { versionInfo = await response.json(); break; }
    } catch { /* not up yet */ }
    await sleep(250);
  }
  if (!versionInfo) { cleanup(); throw new Error(`browser DevTools endpoint did not start (${executable})`); }

  const cdp = await new CDP(versionInfo.webSocketDebuggerUrl).connect();
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Network.enable', {}, sessionId);

  const consoleEntries = [];
  const pageErrors = [];
  cdp.onEvent((message) => {
    if (message.sessionId !== sessionId) return;
    const params = message.params ?? {};
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = (params.args ?? []).map((arg) => String(arg.value ?? arg.description ?? arg.type ?? '')).join(' ');
      consoleEntries.push({ type: params.type, text });
    } else if (message.method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails ?? {};
      pageErrors.push({ text: details.text ?? 'uncaught exception', description: details.exception?.description ?? null, url: details.url ?? null });
    } else if (message.method === 'Log.entryAdded') {
      const entry = params.entry ?? {};
      if (entry.level === 'error') consoleEntries.push({ type: 'log-entry', text: entry.text ?? '', url: entry.url ?? null });
    }
  });

  const driver = {
    executable,
    cdp,
    sessionId,
    consoleEntries,
    pageErrors,
    async evaluate(expression, { awaitPromise = false, returnByValue = true } = {}) {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue }, sessionId);
      if (result.exceptionDetails) {
        throw new Error(`evaluate failed: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? ''}`);
      }
      return result.result?.value;
    },
    async waitFor(expression, { timeoutMs: waitMs = 15000, intervalMs = 120, description = expression } = {}) {
      const end = Date.now() + waitMs;
      let lastError = null;
      while (Date.now() < end) {
        try {
          if (await driver.evaluate(expression)) return true;
        } catch (error) { lastError = error; }
        await sleep(intervalMs);
      }
      throw new Error(`timed out waiting for ${description}${lastError ? ` (${lastError.message})` : ''}`);
    },
    async navigate(url) {
      const loaded = cdp.waitForEvent('Page.loadEventFired', () => true, 30000, sessionId);
      await cdp.send('Page.navigate', { url }, sessionId);
      await loaded.catch(() => undefined);
    },
    async screenshot(path) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.from(shot.data, 'base64'));
      return path;
    },
    cleanup() {
      try { cdp.close(); } catch { /* noop */ }
      cleanup();
    },
  };
  return driver;
}

