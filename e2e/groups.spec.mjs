#!/usr/bin/env node
// e2e/groups.spec.mjs
//
// V1 E2E acceptance (docs/TEST-PLAN.md §5, 13 steps) - zero-dependency.
//
// Drives the real isolated DSH web UI (`.spike-homes/qa`, port 4402) through the
// Chrome DevTools Protocol using the Chromium already present on this machine.
// Selectors come from the frozen contract: docs/CONTRACTS.md §4.1 stable test ids.
//
// Preconditions:
//   * scripts/qa/start-web.ps1 is running (web.json holds the token URL);
//   * the V1 client bundle (lib/client.js) is built and loaded.
// When the client UI is not present yet the runner exits 3 (BLOCKED) with a
// diagnostic, so the pipeline can distinguish "not implemented" from "broken".
//
// Exit codes: 0 = all 13 steps PASS, 1 = a step FAILED, 2 = harness error,
//             3 = BLOCKED (client build / plugin UI missing).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchDriver, sleep } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const QA_HOME = join(REPO_ROOT, '.spike-homes', 'qa');
const SCRIPTS_QA = join(REPO_ROOT, 'scripts', 'qa');
const DEFAULT_EVIDENCE = join(SCRIPTS_QA, 'evidence');
const TOGGLE = '[data-testid="session-groups-toggle"]';
const VIEW = '[data-testid="session-groups-view"]';
const GROUP = '[data-testid="session-groups-group"]';
const GROUP_ADD = '[data-testid="session-groups-group-add"]';
const GROUP_MENU = '[data-testid="session-groups-group-menu"]';
const SESSION = '[data-testid="session-groups-session"]';
const UNGROUPED = '[data-testid="session-groups-ungrouped"]';
const DIALOG = '[data-testid="session-groups-dialog"]';
const DIALOG_INPUT = '[data-testid="session-groups-dialog-input"]';
const DIALOG_CONFIRM = '[data-testid="session-groups-dialog-confirm"]';
const FILTER = '[data-testid="session-groups-archive-filter"]';
const FLAT_FALLBACK = '[data-testid="session-groups-flat-fallback"]';
const RAIL = '[data-testid="session-groups-rail"]';
const RAIL_EXPAND = '[data-testid="session-groups-rail-expand"]';
const RESIZE_HANDLE = '[data-testid="session-groups-resize-handle"]';
const HEADER = '[data-testid="session-groups-header"]';
const SIDEBAR_FRAME_MARKER = '[data-dsg-sidebar-frame]';
const SIDEBAR_WIDTH_KEY = 'dsh-session-groups.width.v1';

// ---------------------------------------------------------------------------
// args / small utils
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { port: 4402, evidenceDir: DEFAULT_EVIDENCE, browser: 'auto', timeoutMs: 20000, screenshot: true };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const next = () => argv[++i];
    if (key === '--port') args.port = Number(next());
    else if (key === '--evidence-dir') args.evidenceDir = next();
    else if (key === '--browser') args.browser = next();
    else if (key === '--timeout-ms') args.timeoutMs = Number(next());
    else if (key === '--no-screenshot') args.screenshot = false;
    else throw new Error(`unknown argument: ${key}`);
  }
  return args;
}

const timestamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function webState(evidenceDir) {
  return readJson(join(evidenceDir, 'web.json'));
}

function workspaceTitles() {
  const workspaceJson = readJson(join(QA_HOME, 'storages', 'workspace.json'));
  const tables = workspaceJson?.tables?.workspaces ?? {};
  return Array.from(Object.values(tables), (workspace) => String(workspace.title ?? '')).filter(Boolean);
}

function workspaceSessionIds() {
  const workspaceJson = readJson(join(QA_HOME, 'storages', 'workspace.json'));
  const tables = workspaceJson?.tables?.workspaces ?? {};
  const ids = new Set();
  for (const workspace of Object.values(tables)) {
    for (const id of Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : []) ids.add(id);
  }
  return ids;
}

function spawnPwsh(script, args) {
  return spawnSync('pwsh', ['-NoProfile', '-File', script, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 300000,
  });
}

/** Fire-and-collect for helper phases whose spawned server would otherwise inherit
 *  our stdio pipes and keep spawnSync waiting for EOF until the server stops. */
function spawnPwshQuiet(script, args) {
  return spawnSync('pwsh', ['-NoProfile', '-File', script, ...args], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    timeout: 180000,
  });
}

// ---------------------------------------------------------------------------
// UI helpers (single source for selectors / gestures)
// ---------------------------------------------------------------------------
function makeUi(driver, helpers) {
  const { timeoutMs } = helpers;

  const evaluate = (expression, options) => driver.evaluate(expression, options);
  const waitFor = (expression, description, waitMs = timeoutMs) => driver.waitFor(expression, { timeoutMs: waitMs, description });

  const readResizeHandlePoint = () =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(RESIZE_HANDLE)});
      if (!el) return null;
      const toggle = document.querySelector(${JSON.stringify(TOGGLE)});
      let sidebarWidth = -1;
      for (let node = toggle; node && node !== document.body; node = node.parentElement) {
        if (node.hasAttribute('data-testid')) continue;
        const width = node.style && node.style.width;
        if (width && /^\\d+(?:\\.\\d+)?px$/.test(width)) { sidebarWidth = node.getBoundingClientRect().width; break; }
      }
      const rect = el.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: Math.min(Math.max(rect.top + rect.height / 2, 20), window.innerHeight - 20),
        left: rect.left,
        sidebarWidth,
      };
    })()`);

  /** Wait until the handle's fixed position aligns with the applied sidebar width. */
  const stableResizeHandlePoint = async () => {
    let previous = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const point = await readResizeHandlePoint();
      if (!point) throw new Error(`resize handle not found: ${RESIZE_HANDLE}`);
      const aligned = point.sidebarWidth > 0 && Math.abs(point.x - point.sidebarWidth) <= 2;
      if (aligned && previous && Math.abs(point.x - previous.x) < 0.5) return point;
      previous = aligned ? point : null;
      await sleep(60);
    }
    const fallback = await readResizeHandlePoint();
    if (!fallback) throw new Error(`resize handle not found: ${RESIZE_HANDLE}`);
    return fallback;
  };

  const ui = {
    waitFor,
    async exists(selector) {
      return Boolean(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`));
    },
    async count(selector) {
      return Number(await evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`));
    },
    async text(selector) {
      return String(await evaluate(`(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').trim()`));
    },
    async attrs(selector, attribute) {
      return await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}), (el) => el.getAttribute(${JSON.stringify(attribute)}))`);
    },
    async click(selector, index = 0) {
      const clicked = await evaluate(`(() => {
        const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        el.click();
        return true;
      })()`);
      if (!clicked) throw new Error(`click target not found: ${selector}[${index}]`);
      return true;
    },
    async clickText(scopeSelector, text) {
      const clicked = await evaluate(`(() => {
        const scope = document.querySelector(${JSON.stringify(scopeSelector)});
        if (!scope) return false;
        const wanted = ${JSON.stringify(text)};
        const nodes = Array.from(scope.querySelectorAll('button, [role="menuitem"], li, a, div[role="option"]'));
        const el = nodes.find((node) => (node.textContent ?? '').trim().includes(wanted));
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        el.click();
        return true;
      })()`);
      if (!clicked) throw new Error(`clickText target not found: '${text}' inside ${scopeSelector}`);
      return true;
    },
    async setNativeValue(selector, value) {
      const ok = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        setter?.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      if (!ok) throw new Error(`input not found: ${selector}`);
    },
    async dismissOverlay() {
      // Preview Notice ("Continue") and the account "Get started" modal can mount
      // a moment after boot. Close by text, then by the dialog close button, then
      // Escape; never click "Sign in" / "Add API Key".
      for (let attempt = 0; attempt < 12; attempt++) {
        const clicked = await evaluate(`(() => {
          const textButton = Array.from(document.querySelectorAll('button')).find((el) => /^(Continue|继续|知道了|关闭)$/i.test((el.textContent ?? '').trim()));
          if (textButton) { textButton.click(); return 'text'; }
          const closeButton = Array.from(document.querySelectorAll('button,[role="button"]')).find((el) => {
            const text = (el.textContent ?? '').trim();
            const label = el.getAttribute('aria-label') ?? '';
            return /^(Close|关闭|×|✕)$/i.test(text) || /^(close|关闭)$/i.test(label);
          });
          if (closeButton) { closeButton.click(); return 'close'; }
          if (document.querySelector('[role="dialog"]')) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return 'escape';
          }
          return false;
        })()`);
        if (!clicked) return attempt > 0;
        await sleep(350);
      }
      return true;
    },
    /**
     * Close the onboarding "Get started" dialog once it has mounted. The dialog
     * mounts asynchronously after reload and its mask blocks real pointer input;
     * only its own Close button is used (never "Sign in" / "Add API Key").
     */
    async closeOnboarding(waitMs = 6000) {
      const end = Date.now() + waitMs;
      while (Date.now() < end) {
        const clicked = await evaluate(`(() => {
          const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
          for (const dialog of dialogs) {
            const label = dialog.getAttribute('aria-label') ?? '';
            const text = (dialog.textContent ?? '').trim();
            if (!/get started|开始使用/i.test(label) && !/Add API Key|Sign in to your DeepSeek|添加 API Key/i.test(text)) continue;
            const close = dialog.querySelector('button[aria-label="Close"], button[aria-label="关闭"], button[title="Close"], button[title="关闭"]');
            if (close) { close.click(); return true; }
          }
          return false;
        })()`);
        if (clicked) {
          await sleep(350);
          return true;
        }
        await sleep(150);
      }
      return false;
    },
    async groups() {
      return await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(GROUP)}), (el) => ({
        gid: el.getAttribute('data-group-id'),
        depth: Number(el.getAttribute('data-depth') ?? 0),
        expanded: el.getAttribute('data-expanded'),
        text: (el.textContent ?? '').trim(),
      }))`);
    },
    async groupIdByName(name) {
      const groups = await ui.groups();
      const match = groups.find((group) => group.text.includes(name));
      return match?.gid ?? null;
    },
    async sessions() {
      return await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(SESSION)}), (el) => ({
        sid: el.getAttribute('data-session-id'),
        groupId: el.getAttribute('data-group-id') ?? null,
        ungrouped: el.getAttribute('data-ungrouped') === 'true',
        archived: el.getAttribute('data-archived') === 'true',
        text: (el.textContent ?? '').trim(),
      }))`);
    },
    async sessionIdsInGroup(gid) {
      return await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(SESSION)} + '[data-group-id="' + ${JSON.stringify(gid)} + '"]'), (el) => el.getAttribute('data-session-id'))`);
    },
    async ungroupedSessionIds() {
      return await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(SESSION)} + '[data-ungrouped="true"]'), (el) => el.getAttribute('data-session-id'))`);
    },
    async dialogOpen() {
      return ui.exists(DIALOG);
    },
    async fillDialog(value) {
      await ui.waitFor(`!!document.querySelector(${JSON.stringify(DIALOG_INPUT)})`, 'dialog input');
      await ui.setNativeValue(DIALOG_INPUT, value);
    },
    async confirmDialog() {
      await ui.click(DIALOG_CONFIRM);
      await ui.waitFor(`!document.querySelector(${JSON.stringify(DIALOG)})`, 'dialog closed');
    },
    async createGroup(name, trigger = 'new-group') {
      if (trigger === 'new-group') await ui.click('[data-testid="session-groups-new-group"]');
      await ui.fillDialog(name);
      await ui.confirmDialog();
      await ui.waitFor(`Array.from(document.querySelectorAll(${JSON.stringify(GROUP)}), (el) => (el.textContent ?? '')).some((t) => t.includes(${JSON.stringify(name)}))`, `group '${name}' visible`);
      return ui.groupIdByName(name);
    },
    async createChildGroup(parentGid, name) {
      await ui.click(`${GROUP_MENU}[data-group-id="${parentGid}"]`);
      await sleep(200);
      const items = await evaluate(`Array.from(document.querySelectorAll('button, [role="menuitem"], li'), (el) => (el.textContent ?? '').trim())`);
      const label = items.find((text) => /新建子分组|子分组/.test(text));
      if (!label) throw new Error(`no '新建子分组' entry in the group menu (items: ${JSON.stringify(items.slice(0, 20))})`);
      await ui.clickText('body', label);
      await ui.fillDialog(name);
      await ui.confirmDialog();
      await ui.waitFor(`Array.from(document.querySelectorAll(${JSON.stringify(GROUP)}), (el) => (el.textContent ?? '')).some((t) => t.includes(${JSON.stringify(name)}))`, `child group '${name}' visible`);
      return ui.groupIdByName(name);
    },
    async toggleMode() {
      await ui.click(TOGGLE);
      await sleep(300);
    },
    async waitGroupsView() {
      await ui.waitFor(`!!document.querySelector(${JSON.stringify(VIEW)})`, 'groups view mounted');
    },
    async waitWorkspaceView() {
      await ui.waitFor(`!document.querySelector(${JSON.stringify(VIEW)})`, 'official workspace view restored');
    },
    /**
     * Width of the official sidebar root (the `SidebarRoot` div with an inline
     * width). Falls back to the sidebar grid column in rail mode where the host
     * omits the inline width. Never measures our own footer toggle.
     */
    async sidebarWidth() {
      return Number(await evaluate(`(() => {
        const toggle = document.querySelector(${JSON.stringify(TOGGLE)});
        if (!toggle) return -1;
        const rectWidth = (el) => el.getBoundingClientRect().width;
        for (let el = toggle; el && el !== document.body; el = el.parentElement) {
          if (el.hasAttribute('data-testid')) continue;
          const width = el.style && el.style.width;
          if (width && /^\\d+(?:\\.\\d+)?px$/.test(width)) return rectWidth(el);
        }
        // Rail / collapsed: the host sets no inline width; measure the sidebar column.
        let frame = null;
        for (let el = toggle.parentElement; el; el = el.parentElement) {
          if (el.style && el.style.gridTemplateColumns) { frame = el; break; }
        }
        if (!frame) return -1;
        let column = toggle;
        while (column && column.parentElement !== frame) column = column.parentElement;
        return column ? rectWidth(column) : -1;
      })()`));
    },
    /** Drag the plugin resize handle with real CDP mouse input to absolute x = targetX. */
    async dragResizeHandle(targetX) {
      const point = await stableResizeHandlePoint();
      const send = (type, x, buttons) => driver.cdp.send('Input.dispatchMouseEvent', {
        type,
        x,
        y: point.y,
        button: 'left',
        buttons,
        clickCount: 1,
      }, driver.sessionId);
      await send('mousePressed', point.x, 1);
      const steps = 6;
      for (let step = 1; step <= steps; step++) {
        await send('mouseMoved', point.x + ((targetX - point.x) * step) / steps, 1);
        await sleep(25);
      }
      await send('mouseReleased', targetX, 0);
      await sleep(200);
    },
    /** Double-click the plugin resize handle (DOM dblclick; the drag itself uses real CDP). */
    async doubleClickResizeHandle() {
      const dispatched = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(RESIZE_HANDLE)});
        if (!el) return false;
        el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
        return true;
      })()`);
      if (!dispatched) throw new Error(`resize handle not found: ${RESIZE_HANDLE}`);
      await sleep(250);
    },
    /** Emulate a viewport width (desktop metrics) and let the host re-layout. */
    async setViewport(width) {
      await driver.cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      }, driver.sessionId);
      await sleep(500);
    },
    /** Drop the emulated viewport and let the host re-layout at the window size. */
    async resetViewport() {
      await driver.cdp.send('Emulation.clearDeviceMetricsOverride', {}, driver.sessionId);
      await sleep(500);
    },
    async dragSessionToGroup(sid, gid) {
      const result = await evaluate(`(() => {
        const source = document.querySelector(${JSON.stringify(SESSION)} + '[data-session-id="' + ${JSON.stringify(sid)} + '"]');
        const target = document.querySelector(${JSON.stringify(GROUP)} + '[data-group-id="' + ${JSON.stringify(gid)} + '"]');
        if (!source || !target) return { ok: false, reason: 'source or target missing' };
        const dt = new DataTransfer();
        const rect = target.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
        for (const type of ['dragenter', 'dragover']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
        source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
        return { ok: true };
      })()`);
      if (!result.ok) throw new Error(`drag ${sid} -> ${gid} failed: ${result.reason}`);
      await sleep(250);
    },
    async dragSessionBefore(sid, targetSid) {
      const result = await evaluate(`(() => {
        const source = document.querySelector(${JSON.stringify(SESSION)} + '[data-session-id="' + ${JSON.stringify(sid)} + '"]');
        const target = document.querySelector(${JSON.stringify(SESSION)} + '[data-session-id="' + ${JSON.stringify(targetSid)} + '"]');
        if (!source || !target) return { ok: false, reason: 'source or target row missing' };
        const dt = new DataTransfer();
        const rect = target.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + Math.max(2, rect.height * 0.2);
        source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
        for (const type of ['dragenter', 'dragover']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
        source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
        return { ok: true };
      })()`);
      if (!result.ok) throw new Error(`reorder ${sid} before ${targetSid} failed: ${result.reason}`);
      await sleep(250);
    },
    async filterState() {
      return await evaluate(`document.querySelector(${JSON.stringify(FILTER)})?.getAttribute('data-filter') ?? null`);
    },
    async setFilter(target) {
      // The V1 archive filter control cycles hidden -> all -> only on click.
      for (let attempt = 0; attempt < 4; attempt++) {
        if ((await ui.filterState()) === target) return true;
        await ui.click(FILTER);
        await sleep(300);
      }
      if ((await ui.filterState()) === target) return true;
      throw new Error(`could not reach archive filter '${target}' (current: ${await ui.filterState()})`);
    },    async openSessionMenu(sid) {
      const button = '[data-testid="session-groups-session-menu"][data-session-id="' + sid + '"]';
      const found = await evaluate(`(() => {
        const direct = document.querySelector(${JSON.stringify(button)});
        if (direct) { direct.click(); return true; }
        // fallback: hover the row so its menu button is rendered, then click it
        const row = document.querySelector(${JSON.stringify(SESSION)} + '[data-session-id="' + ${JSON.stringify(sid)} + '"]');
        if (!row) return false;
        row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
        const nested = row.querySelector('[data-testid="session-groups-session-menu"]');
        if (!nested) return false;
        nested.click();
        return true;
      })()`);
      if (!found) throw new Error(`session menu button not found for ${sid}`);
      await ui.waitFor(`!!document.querySelector('[data-testid="session-groups-menu"]')`, 'session menu open', 5000);
    },
    async menuItems() {
      return await evaluate(`Array.from(document.querySelectorAll('[data-testid="session-groups-menu"] button, [role="menuitem"]'), (el) => (el.textContent ?? '').trim()).filter(Boolean)`);
    },
    async clickMenuItem(pattern) {
      const source = pattern instanceof RegExp ? pattern.source : String(pattern);
      const clicked = await evaluate(`(() => {
        const re = new RegExp(${JSON.stringify(source)});
        const menu = document.querySelector('[data-testid="session-groups-menu"]');
        if (!menu) return null;
        const items = Array.from(menu.querySelectorAll('button, [role="menuitem"]'));
        const el = items.find((node) => re.test(String(node.textContent ?? '').trim()));
        if (!el) return null;
        el.click();
        return (el.textContent ?? '').trim();
      })()`);
      if (!clicked) {
        const items = await ui.menuItems().catch(() => []);
        throw new Error(`menu item ${pattern} not found (items: ${JSON.stringify(items)})`);
      }
      await sleep(300);
      return clicked;
    },    async bodyText() {
      return String(await evaluate(`(document.body?.innerText ?? '').slice(0, 20000)`));
    },
  };
  return ui;
}

// ---------------------------------------------------------------------------
// steps
// ---------------------------------------------------------------------------
function makeSteps({ driver, ui, evidenceDir, args, state }) {
  const shot = async (index, name) => {
    if (!args.screenshot) return null;
    const path = join(evidenceDir, 'screenshots', 'e2e', `${String(index).padStart(2, '0')}-${name}.png`);
    try { await driver.screenshot(path); return path; } catch { return null; }
  };

  const restartServer = async () => {
    console.log('    · restart: stopping server');
    const stop = spawnPwshQuiet(join(SCRIPTS_QA, 'stop-web.ps1'), ['-Port', String(args.port), '-QaHome', QA_HOME, '-EvidenceDir', evidenceDir]);
    if (stop.status !== 0) throw new Error(`stop-web failed with exit ${stop.status}`);
    console.log('    · restart: starting server');
    const start = spawnPwshQuiet(join(SCRIPTS_QA, 'start-web.ps1'), ['-Port', String(args.port), '-QaHome', QA_HOME, '-EvidenceDir', evidenceDir]);
    if (start.status !== 0) throw new Error(`start-web failed with exit ${start.status}`);
    console.log('    · restart: navigating to fresh token URL');
    const stateNow = webState(evidenceDir);
    if (!stateNow?.url) throw new Error('web.json missing token url after restart');
    await driver.navigate(stateNow.url);
    await driver.waitFor(`typeof globalThis.__DSH_BOOT__ !== 'undefined'`, { timeoutMs: 30000, description: 'app boot after restart' });
    await ui.dismissOverlay();
    await sleep(500);
  };

  const safeScreenshot = async (path) => {
    if (!args.screenshot) return null;
    try {
      return await Promise.race([
        driver.screenshot(path),
        sleep(5000).then(() => null),
      ]);
    } catch {
      return null;
    }
  };

  const runAudit = (extraArgs) => spawnPwsh(join(SCRIPTS_QA, 'audit.ps1'), [
    '-Mode', 'verify',
    '-QaHome', QA_HOME,
    '-Port', String(args.port),
    '-EvidenceDir', evidenceDir,
    ...extraArgs,
  ]);

  /** Session ids that have a real session directory under the isolated home
   *  (a blank placeholder without a log cannot be renamed/archived by the host). */
  const hostSessionIds = () => {
    const ids = new Set();
    try {
      const sessionsRoot = join(QA_HOME, 'sessions');
      for (const workspaceDir of readdirSync(sessionsRoot, { withFileTypes: true })) {
        if (!workspaceDir.isDirectory()) continue;
        for (const sessionDir of readdirSync(join(sessionsRoot, workspaceDir.name), { withFileTypes: true })) {
          if (sessionDir.isDirectory()) ids.add(sessionDir.name);
        }
      }
    } catch { /* sessions root missing */ }
    return ids;
  };

  /** Registry-global archived session ids from the isolated home. */
  const archivedSessionIds = () => {
    try {
      const doc = JSON.parse(readFileSync(join(QA_HOME, 'storages', 'workspace.json'), 'utf8'));
      return new Set(doc?.global?.archivedSessionIds ?? []);
    } catch {
      return new Set();
    }
  };

  /** Owning workspace title from the isolated home's workspace registry. */
  const workspaceTitleForSession = (sessionId) => {
    try {
      const doc = JSON.parse(readFileSync(join(QA_HOME, 'storages', 'workspace.json'), 'utf8'));
      for (const workspace of Object.values(doc?.tables?.workspaces ?? {})) {
        if (Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(sessionId)) return String(workspace.title ?? '');
      }
    } catch { /* registry unreadable */ }
    return '';
  };

  const waitForBodyText = async (text, waitMs = 6000) => {
    const end = Date.now() + waitMs;
    while (Date.now() < end) {
      if ((await ui.bodyText()).includes(text)) return true;
      await sleep(250);
    }
    return false;
  };

  /** Expand the official workspace row that owns `sessionId`, so its sessions render. */
  const revealOfficialSession = async (sessionId, title) => {
    const workspaceTitle = workspaceTitleForSession(sessionId);
    const expanded = await driver.evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('[role="treeitem"][data-row-key^="workspace:"]'));
      const wanted = ${JSON.stringify(workspaceTitle)};
      const row = wanted ? rows.find((el) => (el.textContent ?? '').includes(wanted)) : null;
      if (!row) return { found: false, rows: rows.map((el) => (el.textContent ?? '').trim()).slice(0, 10) };
      if (row.getAttribute('aria-expanded') !== 'true') row.click();
      return { found: true, expanded: row.getAttribute('aria-expanded') };
    })()`);
    await sleep(600);
    return { workspaceTitle, ...expanded };
  };

  /** Official content search fallback (button[aria-label=search] + text input). */
  const searchOfficialSidebar = async (title) => {
    const opened = await driver.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('button[aria-label]'))
        .find((el) => /搜索|search/i.test(el.getAttribute('aria-label') ?? ''));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!opened) return false;
    await sleep(500);
    const typed = await driver.evaluate(`(() => {
      const input = document.querySelector('input[type="text"][placeholder]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, ${JSON.stringify(title)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(900);
    return typed;
  };

  return [
    {
      id: 1,
      name: 'official-workspace-view-default',
      async run() {
        const mode = await ui.attrs(TOGGLE, 'data-mode');
        if (!mode.length) throw new Error(`footer toggle ${TOGGLE} missing (client plugin not loaded?)`);
        if (mode[0] !== 'workspace') throw new Error(`expected default data-mode="workspace", got ${mode[0]}`);
        if (await ui.exists(VIEW)) throw new Error('groups view must not be active on first load');
        if (await ui.exists(FLAT_FALLBACK)) throw new Error('flat fallback rendered on first load');
        const titles = workspaceTitles();
        // The official workspace browser hydrates asynchronously after boot.
        await driver.waitFor(
          `(${JSON.stringify(titles)}).some((title) => (document.body?.innerText ?? '').includes(title))`,
          { timeoutMs: args.timeoutMs, description: `official workspace titles ${titles.join(', ')}` },
        );
        const body = await ui.bodyText();
        if (titles.length && !titles.some((title) => body.includes(title))) {
          throw new Error(`official workspace browser did not render any fixture workspace title (${titles.join(', ')})`);
        }
        return { mode: mode[0], workspaceTitles: titles };
      },
    },
    {
      id: 2,
      name: 'toggle-into-groups-view',
      async run() {
        await ui.toggleMode();
        await ui.waitGroupsView();
        const mode = (await ui.attrs(TOGGLE, 'data-mode'))[0];
        if (mode !== 'groups') throw new Error(`toggle data-mode should become "groups", got ${mode}`);
        const sessions = await ui.sessions();
        if (sessions.length === 0) throw new Error('groups view rendered zero session rows');
        const groups = await ui.groups();
        if (groups.length > 0) throw new Error('fresh isolated home should start with zero groups');
        return { sessions: sessions.length, groups: groups.length };
      },
    },
    {
      id: 3,
      name: 'create-three-groups-one-nested',
      async run() {
        const a = await ui.createGroup('施工中');
        const b = await ui.createGroup('已完成');
        const c = await ui.createGroup('稍后处理');
        const child = await ui.createChildGroup(a, '子组A');
        state.groups = { a, b, c, child };
        const groups = await ui.groups();
        if (groups.length !== 4) throw new Error(`expected 4 group rows, got ${groups.length}`);
        const childRow = groups.find((group) => group.gid === child);
        if (!childRow) throw new Error('nested child group row missing');
        if (childRow.depth !== 1) throw new Error(`nested group depth expected 1, got ${childRow.depth}`);
        return { groups: groups.map((group) => ({ gid: group.gid, depth: group.depth })) };
      },
    },
    {
      id: 4,
      name: 'drag-ten-cross-workspace-sessions',
      async run() {
        await ui.dismissOverlay();
        const before = await ui.ungroupedSessionIds();
        if (before.length < 10) throw new Error(`fixtures expose only ${before.length} ungrouped session rows; need >=10 for the 10-session drag step`);
        const picks = before.slice(0, 10);
        const { a, child, b } = state.groups;
        const plan = [
          ...picks.slice(0, 4).map((sid) => [sid, a]),
          ...picks.slice(4, 7).map((sid) => [sid, child]),
          ...picks.slice(7, 10).map((sid) => [sid, b]),
        ];
        for (const [sid, gid] of plan) {
          await ui.dismissOverlay();
          await ui.dragSessionToGroup(sid, gid);
        }
        const sessions = await ui.sessions();
        for (const [sid, gid] of plan) {
          const row = sessions.find((session) => session.sid === sid);
          if (!row) throw new Error(`dragged session ${sid} disappeared`);
          if (row.groupId !== gid) throw new Error(`session ${sid} expected in group ${gid}, got ${row.groupId}`);
        }
        const ungroupedAfter = await ui.ungroupedSessionIds();
        if (ungroupedAfter.length !== before.length - 10) {
          throw new Error(`ungrouped count ${before.length} -> ${ungroupedAfter.length}, expected -10`);
        }
        state.dragged = plan;
        return { moved: plan.length, ungroupedBefore: before.length, ungroupedAfter: ungroupedAfter.length };
      },
    },
    {
      id: 5,
      name: 'reorder-within-group-persists',
      async run() {
        const { a, c } = state.groups;
        const inA = await ui.sessionIdsInGroup(a);
        if (inA.length < 2) throw new Error('group A needs >=2 sessions to test reordering');
        const [first, second] = inA;
        await ui.dragSessionBefore(second, first);
        const after = await ui.sessionIdsInGroup(a);
        if (after[0] !== second) throw new Error(`reorder failed: expected ${second} first, got ${JSON.stringify(after)}`);
        state.reordered = { group: a, order: after };
        return { group: a, order: after };
      },
    },
    {
      id: 6,
      name: 'new-session-in-group-lands-first',
      async run() {
        const { a } = state.groups;
        const before = await ui.sessionIdsInGroup(a);
        const workspaceCandidates = workspaceTitles();
        await ui.click(`${GROUP_ADD}[data-group-id="${a}"]`);
        await sleep(400);
        const dialogs = await ui.count(DIALOG);
        if (dialogs === 0) {
          // Host new-session UI may open instead of our own menu.
          throw new Error('group + did not open the pre-created workspace dialog (functionality missing)');
        }
        const kind = (await ui.attrs(DIALOG, 'data-kind'))[0] ?? '';
        if (kind !== 'new-session') throw new Error(`group + dialog kind expected "new-session", got "${kind}"`);
        const choiceCount = await ui.count('[data-testid="session-groups-dialog-workspace"]');
        if (choiceCount === 0) throw new Error('group + dialog offered no workspace choices');
        const chosen = await driver.evaluate(`(() => {
          const button = document.querySelector('[data-testid="session-groups-dialog-workspace"]');
          if (!button) return null;
          const text = (button.textContent ?? '').trim();
          button.click();
          return text;
        })()`);
        if (!chosen) throw new Error('could not pick a workspace in the group + dialog');
        await ui.waitFor(`!document.querySelector(${JSON.stringify(DIALOG)})`, 'new-session dialog closed', 10000);
        await ui.waitFor(`document.querySelectorAll(${JSON.stringify(SESSION)}).length > 0`, 'session rows present', 10000);
        await ui.waitFor(
          `(async () => true)()`,
          'tick',
          300,
        ).catch(() => undefined);
        await sleep(600);
        const after = await ui.sessionIdsInGroup(a);
        const created = after.filter((sid) => !before.includes(sid));
        if (created.length !== 1) throw new Error(`group + should create exactly one session, created ${created.length} (${created.join(',')})`);
        if (after[0] !== created[0]) throw new Error('new session must land at the head of the group');
        const globalRows = await ui.sessions();
        const occurrences = globalRows.filter((row) => row.sid === created[0]).length;
        if (occurrences !== 1) throw new Error(`new session rendered ${occurrences} times (duplicate blank)`);
        state.createdSession = created[0];
        return { created: created[0], head: after[0], workspace: chosen };
      },
    },
    {
      id: 7,
      name: 'archive-tri-state',
      async run() {
        // Archive a normal (non-blank) session that is currently rendered. The
        // step-6 session is intentionally blank and blank rows are current-only.
        const rows = await ui.sessions();
        const target = rows.find((row) => row.groupId === state.groups.a && !/新会话/.test(row.text || ''))?.sid
          ?? rows.find((row) => row.groupId && !/新会话/.test(row.text || ''))?.sid;
        if (!target) throw new Error('no rendered non-blank session available to archive');
        await ui.openSessionMenu(target);
        let items = [];
        try { items = await ui.menuItems(); } catch { /* menu may be closed */ }
        const archiveLabel = items.find((text) => /归档/.test(text) && !/取消归档/.test(text));
        if (!archiveLabel) {
          throw new Error(`session menu has no archive entry (items: ${JSON.stringify(items.slice(0, 20))})`);
        }
        await ui.clickMenuItem(/^(归档|Archive)$/);
        await sleep(600);
        if ((await ui.count(DIALOG)) > 0) {
          // Running session: the client asks for confirmation before stopping activity.
          await ui.click(DIALOG_CONFIRM);
          await sleep(600);
        }
        const targetGroup = (await ui.sessions()).find((row) => row.sid === target)?.groupId ?? null;

        await ui.setFilter('hidden');
        const hiddenRows = (await ui.sessions()).filter((row) => row.sid === target);
        if (hiddenRows.length !== 0) throw new Error('archived session still visible under hidden filter');

        await ui.setFilter('all');
        const allRow = (await ui.sessions()).find((row) => row.sid === target);
        if (!allRow) throw new Error('archived session missing under the "all" filter');

        await ui.setFilter('only');
        const onlyRows = await ui.sessions();
        if (!onlyRows.some((row) => row.sid === target)) throw new Error('archived session missing under the "only archived" filter');
        if (onlyRows.some((row) => row.archived !== true)) {
          throw new Error('"only archived" filter shows non-archived sessions');
        }

        await ui.setFilter('all');
        await ui.openSessionMenu(target);
        await ui.clickMenuItem(/取消归档|Unarchive/);
        await sleep(600);
        await ui.setFilter('hidden');
        const restored = (await ui.sessions()).find((row) => row.sid === target);
        if (!restored) throw new Error('unarchived session did not return');
        if (targetGroup && restored.groupId !== targetGroup) throw new Error(`unarchived session returned to ${restored.groupId}, expected ${targetGroup}`);
        state.archivedSession = target;
        return { session: target, group: targetGroup };
      },
    },
    {
      id: 8,
      name: 'rename-syncs-with-official-sidebar',
      async run() {
        const rows = await ui.sessions();
        const registered = workspaceSessionIds();
        const archivedIds = archivedSessionIds();
        // Prefer the session created in step 6: it is current, not archived, and the
        // blank->title rename path is an explicit V1 contract. Fall back to any
        // registered, rendered, non-blank, non-archived session.
        const isBlankRow = (row) => /新会话/.test(row.text || '') || row.sid === state.createdSession;
        const hostIds = hostSessionIds();
        const usable = (row) => row
          && !isBlankRow(row)
          && registered.has(row.sid)
          && hostIds.has(row.sid)
          && !archivedIds.has(row.sid)
          && row.sid !== state.archivedSession;
        const realFirst = (row) => usable(row) && !/^session-00000000-/.test(row.sid);
        const candidates = [
          rows.find((row) => realFirst(row) && row.groupId === state.groups.a),
          rows.find((row) => realFirst(row) && row.groupId),
          rows.find((row) => usable(row) && row.groupId === state.groups.a),
          rows.find((row) => row.sid === state.createdSession && hostIds.has(row.sid)),
        ].filter(Boolean);
        const target = candidates[0]?.sid;
        if (!target) throw new Error('no suitable session available to rename');
        console.log('    · step 8: target=' + target);
        await ui.openSessionMenu(target);
        const items = await ui.menuItems();
        if (!items.some((text) => /重命名/.test(text))) throw new Error(`session menu has no rename entry (items: ${JSON.stringify(items.slice(0, 20))})`);
        if (items.some((text) => /删除/.test(text))) throw new Error('session menu must not offer delete (D5)');
        await ui.clickMenuItem(/重命名|Rename/);
        const newTitle = `E2E-重命名-${Date.now().toString(36).slice(-4)}`;
        console.log('    · step 8: rename dialog');
        await ui.fillDialog(newTitle);
        await ui.confirmDialog();
        await ui.waitFor(`Array.from(document.querySelectorAll(${JSON.stringify(SESSION)}), (el) => (el.textContent ?? '')).some((t) => t.includes(${JSON.stringify(newTitle)}))`, 'renamed row shows new title');
        console.log('    · step 8: switching back to workspace view');
        await ui.toggleMode();
        await ui.waitWorkspaceView();
        await sleep(600);
        let appeared = await waitForBodyText(newTitle, 3000);
        let reveal = null;
        let searched = false;
        if (!appeared) {
          // The official browser only renders a workspace's sessions when that
          // workspace row is expanded.
          console.log('    · step 8: expanding owning workspace');
          reveal = await revealOfficialSession(target, newTitle);
          appeared = await waitForBodyText(newTitle, 6000);
        }
        if (!appeared) {
          console.log('    · step 8: search fallback');
          searched = await searchOfficialSidebar(newTitle);
          appeared = await waitForBodyText(newTitle, 6000);
        }
        if (!appeared) {
          const expandedRows = await driver.evaluate(`Array.from(document.querySelectorAll('[role="treeitem"][aria-expanded]')).map((el) => ({ key: el.getAttribute('data-row-key'), expanded: el.getAttribute('aria-expanded'), text: (el.textContent ?? '').trim().slice(0, 60) })).slice(0, 12)`);
          const bodyTail = (await ui.bodyText()).slice(-1200);
          throw new Error(`official sidebar did not show renamed title '${newTitle}' (workspace=${JSON.stringify(reveal)} search=${searched} rows=${JSON.stringify(expandedRows)} bodyTail=${JSON.stringify(bodyTail)})`);
        }
        state.renamedTitle = newTitle;
        return { session: target, title: newTitle, reveal, searched };
      },
    },
    {
      id: 9,
      name: 'rail-expand-available',
      async run() {
        await ui.toggleMode();
        await ui.waitGroupsView();
        const collapsed = await driver.evaluate(`(() => {
          const selectors = ['button[aria-label*="收起"]', 'button[title*="收起"]', 'button[aria-label*="Collapse"]', 'button[title*="Collapse"]'];
          for (const selector of selectors) {
            const button = document.querySelector(selector);
            if (button) { button.click(); return true; }
          }
          return false;
        })()`);
        if (!collapsed) {
          const error = new Error('no official sidebar collapse control found to enter the 56px rail');
          error.blocked = true;
          throw error;
        }
        await sleep(400);
        const hasRail = await ui.exists(RAIL);
        const hasExpand = await ui.exists(RAIL_EXPAND);
        if (!hasRail && !hasExpand) throw new Error('neither the rail placeholder nor the expand button rendered in 56px mode');
        if (hasExpand) {
          await ui.click(RAIL_EXPAND);
          await sleep(500);
          if (!(await ui.exists(VIEW))) throw new Error('rail expand did not restore the groups view');
        }
        return { rail: hasRail, expand: hasExpand };
      },
    },
    {
      id: 10,
      name: 'restart-preserves-structure',
      async run() {
        const beforeGroups = await ui.groups();
        const beforeFilter = await ui.filterState();
        const isBlankRow = (row) => /新会话/.test(row.text || '') || row.sid === state.createdSession;
        const realOrder = async () => (await ui.sessions()).filter((row) => row.groupId === state.groups.a && !isBlankRow(row)).map((row) => row.sid);
        const beforeOrder = await realOrder();
        const beforeBlankActive = (await ui.sessions()).filter((row) => isBlankRow(row) && row.groupId === state.groups.a).map((row) => row.sid);
        await restartServer();
        const mode = (await ui.attrs(TOGGLE, 'data-mode'))[0] ?? null;
        if (mode !== 'groups') await ui.toggleMode();
        await ui.waitGroupsView();
        const afterGroups = await ui.groups();
        if (afterGroups.length !== beforeGroups.length) {
          throw new Error(`groups count changed across restart: ${beforeGroups.length} -> ${afterGroups.length}`);
        }
        const beforeByName = beforeGroups.map((group) => group.text).sort();
        const afterByName = afterGroups.map((group) => group.text).sort();
        if (JSON.stringify(beforeByName) !== JSON.stringify(afterByName)) {
          throw new Error('group names changed across restart');
        }
        const actual = await realOrder();
        if (JSON.stringify(actual) !== JSON.stringify(beforeOrder)) {
          throw new Error(`non-blank group order not persisted across restart: ${JSON.stringify(beforeOrder)} -> ${JSON.stringify(actual)}`);
        }
        const afterFilter = await ui.filterState();
        if (beforeFilter && afterFilter && beforeFilter !== afterFilter) {
          throw new Error(`archive filter not persisted across restart: ${beforeFilter} -> ${afterFilter}`);
        }
        // Blank sessions are temporary placeholders. DSH may drop the old blank id and
        // allocate a new one on restart (drift); when that happens the OLD id must not
        // reappear inside a group, and the NEW blank must sit in the ungrouped inbox
        // (never auto-assigned to a group). When the id is stable (no drift),
        // continuity of the same current blank is fine.
        const afterRows = await ui.sessions();
        const blankIdsBefore = new Set(beforeBlankActive);
        const blankIdsAfter = afterRows.filter((row) => isBlankRow(row)).map((row) => row.sid);
        const oldBlankKept = blankIdsAfter.some((sid) => blankIdsBefore.has(sid));
        const drift = blankIdsBefore.size > 0 && blankIdsAfter.length > 0 && !oldBlankKept;
        const blankLifecycle = { drift, before: [...blankIdsBefore], after: blankIdsAfter, oldResurrected: [], autoGroupedNew: [] };
        if (drift) {
          const oldResurrected = afterRows.filter((row) => blankIdsBefore.has(row.sid) && row.groupId !== null);
          if (oldResurrected.length > 0) {
            throw new Error(`old blank id resurrected into a group after restart drift: ${JSON.stringify(oldResurrected)}`);
          }
          const newBlankIds = blankIdsAfter.filter((sid) => !blankIdsBefore.has(sid));
          const autoGroupedNew = afterRows.filter((row) => newBlankIds.includes(row.sid) && row.groupId !== null);
          if (autoGroupedNew.length > 0) {
            throw new Error(`new blank session auto-assigned to a group after restart: ${JSON.stringify(autoGroupedNew.map((row) => ({ sid: row.sid, groupId: row.groupId })))}`);
          }
          blankLifecycle.autoGroupedNew = [];
        }
        if (state.renamedTitle) {
          const body = await ui.bodyText();
          if (!body.includes(state.renamedTitle)) throw new Error('renamed title lost after restart');
        }
        return { groups: afterGroups.length, filter: afterFilter, blankLifecycle };
      },
    },
    {
      id: 11,
      name: 'switch-back-official-no-duplicates',
      async run() {
        await ui.toggleMode();
        await ui.waitWorkspaceView();
        if (await ui.exists(VIEW)) throw new Error('groups view still mounted after switching back');
        const body = await ui.bodyText();
        for (const title of workspaceTitles()) {
          if (title && !body.includes(title)) throw new Error(`official workspace browser lost workspace '${title}' after switch-back`);
        }
        state.renamedTitle && body.includes(state.renamedTitle);
        // No duplicate row: every visible session title should appear at most twice
        // (once in the official sidebar; the groups view is unmounted).
        if (state.renamedTitle) {
          const occurrences = body.split(state.renamedTitle).length - 1;
          if (occurrences > 2) throw new Error(`renamed session appears ${occurrences} times after switch-back (duplicate rows)`);
        }
        return { officialView: true };
      },
    },
    {
      id: 12,
      name: 'data-audit-only-record-file-changed',
      async run() {
        const result = runAudit(['-ExpectGroupFile', 'change', '-AllowHostSessionChanges']);
        const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
        if (result.status !== 0) {
          throw new Error(`audit failed (exit ${result.status}): ${combined.slice(-1500)}`);
        }
        const recordPath = join(QA_HOME, 'storages', 'dsh-session-groups.json');
        if (!existsSync(recordPath)) throw new Error('record file missing after E2E grouping operations');
        const record = JSON.parse(readFileSync(recordPath, 'utf8'));
        if (!Array.isArray(record.groups) || record.groups.length < 3) {
          throw new Error(`record file does not contain the created groups: ${JSON.stringify(record.groups?.length)}`);
        }
        if (!(record.revision > 0)) throw new Error('record revision did not advance');
        return { revision: record.revision, groups: record.groups.length, audit: 'PASS' };
      },
    },
    {
      id: 13,
      name: 'resize-sidebar-and-restore-official',
      async run() {
        const assertNear = (actual, expected, label, tolerance = 2) => {
          if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
            throw new Error(`${label}: expected ${expected} ±${tolerance}px, got ${actual}`);
          }
        };
        const waitWidth = async (expected, label, tolerance = 2, waitMs = 8000) => {
          const end = Date.now() + waitMs;
          let last = -1;
          while (Date.now() < end) {
            last = await ui.sidebarWidth();
            if (Number.isFinite(last) && Math.abs(last - expected) <= tolerance) return last;
            await sleep(120);
          }
          throw new Error(`${label}: expected ${expected} ±${tolerance}px, got ${last}`);
        };
        const overrideMarker = () => ui.exists(SIDEBAR_FRAME_MARKER);

        // Step 12 leaves the official workspace view active: record its width first.
        const official = await ui.sidebarWidth();
        if (!(official > 0)) throw new Error(`could not measure the official sidebar width before switching (got ${official})`);
        await ui.toggleMode();
        await ui.waitGroupsView();
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(RESIZE_HANDLE)})`, 'resize handle mounts in groups view');
        if (!(await overrideMarker())) throw new Error('width override marker missing after mounting the groups view');

        await ui.dragResizeHandle(620);
        const widened = await waitWidth(620, 'width after dragging the resize handle');
        const stored = await driver.evaluate(`localStorage.getItem(${JSON.stringify(SIDEBAR_WIDTH_KEY)})`);
        if (stored !== '620') throw new Error(`localStorage ${SIDEBAR_WIDTH_KEY} expected "620", got ${JSON.stringify(stored)}`);

        // The persisted width and the view mode survive a reload.
        await driver.navigate(webState(args.evidenceDir).url);
        await driver.waitFor(`typeof globalThis.__DSH_BOOT__ !== 'undefined'`, { timeoutMs: 30000, description: 'app boot after reload' });
        await sleep(400);
        await ui.dismissOverlay();
        await ui.closeOnboarding();
        await sleep(400);
        if ((await ui.attrs(TOGGLE, 'data-mode'))[0] !== 'groups') await ui.toggleMode();
        await ui.waitGroupsView();
        const reloaded = await waitWidth(620, 'width after reload');
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(RESIZE_HANDLE)})`, 'resize handle after reload');

        // Narrow viewport: the host auto-collapses to the rail and the width
        // override must be dropped (clampSidebarWidth returns null at 700px).
        await ui.setViewport(700);
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(RAIL_EXPAND)})`, 'rail expand button at 700px');
        await ui.click(RAIL_EXPAND);
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(VIEW)})`, 'groups view after rail expand at 700px');
        await sleep(400);
        if (await ui.exists(RESIZE_HANDLE)) throw new Error('resize handle must be hidden when the viewport cannot host a wider sidebar (700px)');
        if (await overrideMarker()) throw new Error('width override marker must be cleared when the viewport cannot host a wider sidebar');
        const narrow = await ui.sidebarWidth();
        if (!(narrow >= 264 && narrow <= 420)) throw new Error(`official narrow sidebar width expected within 264-420px, got ${narrow}`);

        // Back to 1440: the stored width wins again (and the official sidebar is
        // still expanded, since the narrow expand only set narrowExpanded).
        await ui.resetViewport();
        await sleep(300);
        if (await ui.exists(RAIL_EXPAND)) {
          await ui.click(RAIL_EXPAND);
          await sleep(600);
        }
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(RESIZE_HANDLE)})`, 'resize handle returns at 1440', 8000);
        const restored = await waitWidth(620, 'width restored at 1440px');

        await ui.doubleClickResizeHandle();
        const reset = await waitWidth(420, 'width after double-click reset');

        // A late-mounting onboarding dialog would cover the handle's hit area.
        await ui.closeOnboarding(1500);
        await ui.dragResizeHandle(264);
        const minimum = await waitWidth(264, 'width after dragging to the minimum');
        const header = await driver.evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(HEADER)});
          return el ? { clientWidth: el.clientWidth, scrollWidth: el.scrollWidth } : null;
        })()`);
        if (!header) throw new Error('groups header is missing at 264px');
        if (header.scrollWidth > header.clientWidth + 1) {
          throw new Error(`groups header overflows horizontally at 264px: scrollWidth ${header.scrollWidth} > clientWidth ${header.clientWidth}`);
        }

        // Rail round-trip with the existing official collapse control: the override
        // must be cleared, and expanding restores the last persisted width (§3.1).
        const collapseSelector = await driver.evaluate(`(() => {
          const selectors = ['button[aria-label*="收起"]', 'button[title*="收起"]', 'button[aria-label*="Collapse"]', 'button[title*="Collapse"]'];
          for (const selector of selectors) {
            const button = document.querySelector(selector);
            if (button) { button.click(); return selector; }
          }
          return null;
        })()`);
        if (!collapseSelector) throw new Error('no official sidebar collapse control found to enter the rail');
        await ui.waitFor(`!document.querySelector(${JSON.stringify(RESIZE_HANDLE)})`, 'resize handle removed in rail mode', 8000);
        if (await overrideMarker()) throw new Error('width override marker must be cleared in rail mode');
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(RAIL_EXPAND)})`, 'rail expand button after collapse', 8000);
        await ui.click(RAIL_EXPAND);
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(VIEW)})`, 'groups view after expanding the rail');
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(RESIZE_HANDLE)})`, 'resize handle after expanding the rail', 8000);
        const persistedMinimum = await waitWidth(264, 'persisted width after the rail round-trip');
        if (!(await overrideMarker())) throw new Error('width override marker missing after expanding the rail');

        // Back to the official view: handle gone, no override, width restored.
        await ui.toggleMode();
        await ui.waitWorkspaceView();
        await ui.waitFor(`!document.querySelector(${JSON.stringify(RESIZE_HANDLE)})`, 'resize handle removed in workspace view');
        await sleep(400);
        if (await overrideMarker()) throw new Error('width override marker must be cleared in the workspace view');
        const officialRestored = await ui.sidebarWidth();
        assertNear(officialRestored, official, 'official sidebar width after switch-back');
        return { official, widened, reloaded, narrow, restored, reset, minimum, persistedMinimum, officialRestored, header };
      },
    },
  ];
}

/** Capture a screenshot but never let a broken CDP session hang the run. */
async function captureScreenshot(driver, args, path) {
  if (!args.screenshot) return null;
  try {
    return await Promise.race([driver.screenshot(path), sleep(5000).then(() => null)]);
  } catch {
    return null;
  }
}
// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);
  const evidenceDir = resolve(args.evidenceDir);
  mkdirSync(join(evidenceDir, 'screenshots', 'e2e'), { recursive: true });
  const startedAt = new Date().toISOString();
  const evidence = {
    kind: 'v1-e2e',
    createdAt: startedAt,
    port: args.port,
    qaHome: QA_HOME,
    steps: [],
    consoleErrors: [],
    pageErrors: [],
    result: 'FAIL',
    blockedReason: null,
  };

  // Preconditions: isolated server state + client bundle.
  const state = webState(evidenceDir);
  const clientBundle = join(REPO_ROOT, 'lib', 'client.js');
  if (!state?.url) {
    evidence.result = 'BLOCKED';
    evidence.blockedReason = 'scripts/qa/evidence/web.json missing; run scripts/qa/start-web.ps1 first';
    writeFileSync(join(evidenceDir, `e2e-${timestamp()}.json`), JSON.stringify(evidence, null, 2));
    console.log(`[BLOCKED] ${evidence.blockedReason}`);
    return 3;
  }
  if (!existsSync(clientBundle)) {
    evidence.result = 'BLOCKED';
    evidence.blockedReason = 'lib/client.js missing; build the client bundle first (`pnpm build` / node scripts/build-client.mjs)';
    writeFileSync(join(evidenceDir, `e2e-${timestamp()}.json`), JSON.stringify(evidence, null, 2));
    console.log(`[BLOCKED] ${evidence.blockedReason}`);
    return 3;
  }

  // Baseline audit snapshot before any grouping operation (step 12 verifies afterwards).
  const baseline = spawnPwsh(join(SCRIPTS_QA, 'audit.ps1'), ['-Mode', 'baseline', '-QaHome', QA_HOME, '-Port', String(args.port), '-EvidenceDir', evidenceDir]);
  if (baseline.status !== 0) {
    console.error(`E2E ERROR: audit baseline failed: ${baseline.stderr || baseline.stdout}`);
    return 2;
  }

  console.log('');
  console.log('============================================================');
  console.log(' V1 E2E - 13-step acceptance (isolated .spike-homes/qa, CDP)');
  console.log('============================================================');

  let driver = null;
  let failed = false;
  try {
    driver = await launchDriver({ browser: args.browser, timeoutMs: args.timeoutMs });
    const ui = makeUi(driver, { timeoutMs: args.timeoutMs });
    await driver.navigate(state.url);
    await driver.waitFor(`typeof globalThis.__DSH_BOOT__ !== 'undefined'`, { timeoutMs: 30000, description: 'app boot payload' });
    await driver.waitFor(`!!document.querySelector('#root') && document.querySelector('#root').children.length > 0`, { timeoutMs: 30000, description: 'React root mounted' });
    await ui.dismissOverlay();
    await sleep(800);

    // BLOCKED precondition: the plugin's footer toggle must exist.
    if (!(await ui.exists(TOGGLE))) {
      evidence.result = 'BLOCKED';
      evidence.blockedReason = `client UI missing: ${TOGGLE} not rendered (client bundle not loaded or plugin not installed)`;
      console.log(`[BLOCKED] ${evidence.blockedReason}`);
      await captureScreenshot(driver, args, join(evidenceDir, 'screenshots', 'e2e', '00-blocked-no-toggle.png'));
      return 3;
    }

    const steps = makeSteps({ driver, ui, evidenceDir, args, state });
    for (const step of steps) {
      const started = Date.now();
      try {
        const stepTimeoutMs = Number(process.env.E2E_STEP_TIMEOUT_MS ?? 90000);
        const detail = await Promise.race([
          step.run(),
          sleep(stepTimeoutMs).then(() => { throw new Error(`step timed out after ${stepTimeoutMs}ms`); }),
        ]);
        const screenshot = await (args.screenshot
          ? captureScreenshot(driver, args, join(evidenceDir, 'screenshots', 'e2e', `${String(step.id).padStart(2, '0')}-${step.name}.png`)).catch(() => null)
          : null);
        evidence.steps.push({ id: step.id, name: step.name, status: 'PASS', ms: Date.now() - started, detail, screenshot });
        console.log(`  [PASS] step ${step.id}: ${step.name}`);
      } catch (error) {
        const screenshot = await captureScreenshot(driver, args, join(evidenceDir, 'screenshots', 'e2e', `${String(step.id).padStart(2, '0')}-${step.name}-FAIL.png`)).catch(() => null);
        const blocked = error?.blocked === true;
        evidence.steps.push({
          id: step.id,
          name: step.name,
          status: blocked ? 'BLOCKED' : 'FAIL',
          ms: Date.now() - started,
          error: error?.message ?? String(error),
          screenshot,
        });
        console.log(`  [${blocked ? 'BLOCKED' : 'FAIL'}] step ${step.id}: ${step.name} - ${error?.message ?? error}`);
        if (blocked) {
          evidence.result = 'BLOCKED';
          evidence.blockedReason = `step ${step.id} blocked: ${error?.message ?? error}`;
        } else {
          failed = true;
          evidence.result = 'FAIL';
        }
        break;
      }
    }

    if (!failed && !evidence.blockedReason) evidence.result = 'PASS';
  } catch (error) {
    console.error(`E2E ERROR: ${error?.stack ?? error}`);
    evidence.result = 'FAIL';
    evidence.error = String(error?.message ?? error);
    failed = true;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    evidence.consoleErrors = (driver?.consoleEntries ?? []).filter((entry) => entry.type === 'error').slice(0, 50);
    evidence.pageErrors = (driver?.pageErrors ?? []).slice(0, 50);
    const evidencePath = join(evidenceDir, `e2e-${timestamp()}.json`);
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
    console.log('');
    console.log(`=== E2E: ${evidence.result} ===`);
    console.log(`steps: ${evidence.steps.filter((step) => step.status === 'PASS').length}/${evidence.steps.length} PASS`);
    if (evidence.blockedReason) console.log(`blocked: ${evidence.blockedReason}`);
    if (evidence.pageErrors.length) console.log(`page errors: ${JSON.stringify(evidence.pageErrors.slice(0, 5))}`);
    if (evidence.consoleErrors.length) console.log(`console errors: ${JSON.stringify(evidence.consoleErrors.slice(0, 8))}`);
    console.log(`evidence: ${evidencePath}`);
    try { driver?.cleanup(); } catch { /* noop */ }
  }

  if (evidence.result === 'BLOCKED') return 3;
  return failed ? 1 : 0;
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  console.error(error);
  process.exitCode = 2;
});

















