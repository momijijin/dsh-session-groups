#!/usr/bin/env node
// e2e/groups.spec.mjs
//
// V1 E2E acceptance (docs/TEST-PLAN.md §5, 18 steps) - zero-dependency.
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
// Exit codes: 0 = all 18 steps PASS, 1 = a step FAILED, 2 = harness error,
//             3 = BLOCKED (client build / plugin UI missing).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchDriver, sleep } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
// Isolated DSH home used by the QA harness; overridable with --qa-home so a
// fresh home can be used without deleting a previous run's artifacts.
let QA_HOME = join(REPO_ROOT, '.spike-homes', 'qa');
const SCRIPTS_QA = join(REPO_ROOT, 'scripts', 'qa');
const DEFAULT_EVIDENCE = join(SCRIPTS_QA, 'evidence');
const TOGGLE = '[data-testid="session-groups-toggle"]';
const VIEW = '[data-testid="session-groups-view"]';
const GROUP = '[data-testid="session-groups-group"]';
const GROUP_ADD = '[data-testid="session-groups-group-add"]';
const GROUP_MENU = '[data-testid="session-groups-group-menu"]';
const GROUP_DROP = '[data-testid="session-groups-group-drop"]';
const GROUP_MOVE_UP = 'session-groups-group-move-up';
const GROUP_MOVE_DOWN = 'session-groups-group-move-down';
const MENU = '[data-testid="session-groups-menu"]';
const SESSION = '[data-testid="session-groups-session"]';
const UNGROUPED = '[data-testid="session-groups-ungrouped"]';
const DIALOG = '[data-testid="session-groups-dialog"]';
const DIALOG_INPUT = '[data-testid="session-groups-dialog-input"]';
const DIALOG_CONFIRM = '[data-testid="session-groups-dialog-confirm"]';
const FILTER_STATE = '[data-testid="session-groups-view-options"]';
const VIEW_OPTIONS = '[data-testid="session-groups-view-options"]';
const VIEW_OPTIONS_POPOVER = '[data-testid="session-groups-view-options-popover"]';
const ARCHIVE_OPTION = '[data-testid="session-groups-archive-filter"]';
const FLAT_FALLBACK = '[data-testid="session-groups-flat-fallback"]';
const RAIL = '[data-testid="session-groups-rail"]';
const RAIL_EXPAND = '[data-testid="session-groups-rail-expand"]';
const RESIZE_HANDLE = '[data-testid="session-groups-resize-handle"]';
const OFFICIAL_HANDLE = '[data-side="sidebar"]';
const HEADER = '[data-testid="session-groups-header"]';
const SIDEBAR_FRAME_MARKER = '[data-dsg-sidebar-frame]';
const SIDEBAR_WIDTH_KEY = 'dsh-session-groups.width.v1';
const SEARCH = '[data-testid="session-groups-search"]';
const SEARCH_TOGGLE = '[data-testid="session-groups-search-toggle"]';
const SEARCH_CLOSE = '[data-testid="session-groups-search-close"]';
const SEARCH_RESULTS = '[data-testid="session-groups-search-results"]';
const SEARCH_RESULT = '[data-testid="session-groups-search-result"]';
const SEARCH_EMPTY = '[data-testid="session-groups-search-empty"]';
const TOAST = '[data-testid="session-groups-toast"]';
const DROP_INDICATOR = '[data-testid="session-groups-drop-indicator"]';
const TREE = '.dsg-tree';

// ---------------------------------------------------------------------------
// args / small utils
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { port: 4402, evidenceDir: DEFAULT_EVIDENCE, browser: 'auto', timeoutMs: 20000, screenshot: true, qaHome: null };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const next = () => argv[++i];
    if (key === '--port') args.port = Number(next());
    else if (key === '--evidence-dir') args.evidenceDir = next();
    else if (key === '--browser') args.browser = next();
    else if (key === '--timeout-ms') args.timeoutMs = Number(next());
    else if (key === '--no-screenshot') args.screenshot = false;
    else if (key === '--qa-home') args.qaHome = next();
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

  let commitHold = null;

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
    /** Logical ungrouped count from the section header (virtualization-safe). */
    async ungroupedCount() {
      const value = await evaluate(`Number(document.querySelector(${JSON.stringify(UNGROUPED)})?.getAttribute('data-count') ?? NaN)`);
      return Number.isFinite(value) ? value : null;
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
      // Single footer button: clicking it toggles groups <-> official workspace.
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
    /**
     * Whether the host's own sidebar resize handle (`[data-side="sidebar"]`) is
     * actually visible. The width override hides it with CSS (the element stays
     * in the DOM), so existence alone is not enough.
     */
    async officialHandleVisible() {
      return Boolean(await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(OFFICIAL_HANDLE)});
        if (!el) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
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
    /**
     * Fast release: press, one move and release with no wait, so the last
     * pointermove's animation frame is still pending when pointerup commits.
     * The applied sidebar width must still match the persisted width.
     */
    async dragResizeHandleFast(targetX) {
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
      await send('mouseMoved', targetX, 1);
      await send('mouseReleased', targetX, 0);
      await sleep(400);
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
      await ui.waitFor(`document.querySelector(${JSON.stringify(VIEW)})?.getAttribute('data-optimistic') === 'false'`, `session drag ${sid} -> ${gid} persisted`, 10000);
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
      await ui.waitFor(`document.querySelector(${JSON.stringify(VIEW)})?.getAttribute('data-optimistic') === 'false'`, `session reorder ${sid} persisted`, 10000);
    },
    // --- stepwise drag + optimistic/placeholder helpers (0.2.4) -------------
    /** Start a session drag and keep the DataTransfer plus source element. */
    async beginSessionDrag(sid) {
      const result = await evaluate(`(() => {
        const source = document.querySelector(${JSON.stringify(SESSION)} + '[data-session-id="' + ${JSON.stringify(sid)} + '"]');
        if (!source) return { ok: false, reason: 'session row missing' };
        const dt = new DataTransfer();
        window.__dsgDragTransfer = dt;
        window.__dsgDragSource = source;
        source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
        return { ok: true };
      })()`);
      if (!result.ok) throw new Error(`begin session drag ${sid}: ${result.reason}`);
      await sleep(120);
    },
    /** Start a group drag (synthetic dragstart on the header). */
    async beginGroupDrag(gid) {
      const result = await evaluate(`(() => {
        const source = document.querySelector(${JSON.stringify(GROUP)} + '[data-group-id="' + ${JSON.stringify(gid)} + '"]');
        if (!source) return { ok: false, reason: 'group row missing' };
        const dt = new DataTransfer();
        window.__dsgDragTransfer = dt;
        window.__dsgDragSource = source;
        source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
        return { ok: true };
      })()`);
      if (!result.ok) throw new Error(`begin group drag ${gid}: ${result.reason}`);
      await sleep(120);
    },
    /** Hover one element (dragenter + dragover) at a vertical ratio. */
    async dragHover(selector, ratio = 0.5) {
      const result = await evaluate(`(() => {
        const target = document.querySelector(${JSON.stringify(selector)});
        if (!target) return { ok: false, reason: 'hover target missing' };
        const rect = target.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + Math.max(2, rect.height * ${Number(ratio)});
        const dt = window.__dsgDragTransfer ?? new DataTransfer();
        window.__dsgDragTransfer = dt;
        for (const type of ['dragenter', 'dragover']) {
          target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
        }
        return { ok: true, top: rect.top, bottom: rect.bottom, height: rect.height };
      })()`);
      if (!result.ok) throw new Error(`drag hover ${selector}: ${result.reason}`);
      await sleep(150);
      return result;
    },
    /** Drop on one element at a vertical ratio, then end the drag on the source. */
    async dragDrop(selector, ratio = 0.5) {
      const result = await evaluate(`(() => {
        const target = document.querySelector(${JSON.stringify(selector)});
        if (!target) return { ok: false, reason: 'drop target missing' };
        const rect = target.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + Math.max(2, rect.height * ${Number(ratio)});
        const dt = window.__dsgDragTransfer ?? new DataTransfer();
        window.__dsgDragTransfer = dt;
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
        const source = window.__dsgDragSource;
        if (source) source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
        window.__dsgDragSource = null;
        return { ok: true };
      })()`);
      if (!result.ok) throw new Error(`drag drop ${selector}: ${result.reason}`);
    },
    /** Dispatch dragleave (pointer left the row) to clear the placeholder. */
    async dragLeave(selector) {
      const result = await evaluate(`(() => {
        const target = document.querySelector(${JSON.stringify(selector)});
        if (!target) return { ok: false, reason: 'dragleave target missing' };
        const dt = window.__dsgDragTransfer ?? new DataTransfer();
        target.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, dataTransfer: dt, relatedTarget: document.body }));
        return { ok: true };
      })()`);
      if (!result.ok) throw new Error(`drag leave ${selector}: ${result.reason}`);
      await sleep(120);
    },
    /** End the current drag without dropping. */
    async endDrag() {
      await evaluate(`(() => {
        const source = window.__dsgDragSource;
        if (source) source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: window.__dsgDragTransfer ?? new DataTransfer() }));
        window.__dsgDragSource = null;
      })()`);
      await sleep(120);
    },
    /** Current insertion placeholder, including its row height and theme colors. */
    async placeholderInfo() {
      return await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(DROP_INDICATOR)});
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          kind: el.getAttribute('data-drop-kind'),
          target: el.getAttribute('data-drop-target'),
          height: rect.height,
          width: rect.width,
          top: rect.top,
          bottom: rect.bottom,
          label: (el.textContent ?? '').trim(),
          borderStyle: style.borderTopStyle,
          borderColor: style.borderTopColor,
          background: style.backgroundColor,
          color: style.color,
        };
      })()`);
    },
    async waitNoPlaceholder(description = 'placeholder cleared') {
      await ui.waitFor(`!document.querySelector(${JSON.stringify(DROP_INDICATOR)})`, description, 5000);
    },
    async rect(selector) {
      return await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: rect.height, left: rect.left, width: rect.width };
      })()`);
    },
    /**
     * Apply browser-network latency (CDP, not a page fetch wrapper). Used to hold
     * the commit response while the test reads the already-updated DOM/file.
     */
    /**
     * Hold commit requests at the CDP Fetch layer (Request stage). The drop still
     * dispatches optimistically; the HTTP request stays paused until
     * `releaseHeldCommits()`, which proves the DOM moved before persistence.
     */
    async beginCommitHold() {
      if (commitHold) return
      const held = []
      const off = driver.cdp.onEvent((message) => {
        if (message.sessionId !== driver.sessionId) return
        if (message.method === 'Fetch.requestPaused') held.push(message.params)
      })
      await driver.cdp.send('Fetch.enable', {
        patterns: [{ urlPattern: '*dsh-session-groups/commit*', requestStage: 'Request' }],
      }, driver.sessionId)
      commitHold = { held, off }
    },
    async waitHeldCommit(count = 1, waitMs = 8000) {
      const end = Date.now() + waitMs
      while (Date.now() < end) {
        if (commitHold && commitHold.held.length >= count) return commitHold.held
        await sleep(60)
      }
      throw new Error(`timed out waiting for ${count} held commit request(s)`)
    },
    async releaseHeldCommits() {
      if (!commitHold) return 0
      const { held, off } = commitHold
      commitHold = null
      let released = 0
      for (const params of held) {
        try {
          await driver.cdp.send('Fetch.continueRequest', { requestId: params.requestId }, driver.sessionId)
          released += 1
        } catch {
          /* request may already be gone */
        }
      }
      try {
        await driver.cdp.send('Fetch.disable', {}, driver.sessionId)
      } catch {
        /* disable is best effort */
      }
      off()
      return released
    },
    // --- group drag / group menu helpers (step 14) --------------------------
    /**
     * Root group ids in DOM order (`data-depth="0"` excludes nested child rows).
     */
    async rootGroupIds() {
      return await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(GROUP)} + '[data-depth="0"]'), (el) => el.getAttribute('data-group-id'))`);
    },
    async waitRootGroups(expected, waitMs = 8000) {
      const expr = `JSON.stringify(Array.from(document.querySelectorAll(${JSON.stringify(GROUP)} + '[data-depth="0"]'), (el) => el.getAttribute('data-group-id')))`;
      await ui.waitFor(`${expr} === ${JSON.stringify(JSON.stringify(expected))}`, `root group order ${expected.join(',')}`, waitMs);
      // 0.2.4 optimistic drops render before the HTTP write. Revision-based
      // assertions (self/no-op/middle-zone) need the single writer to settle so a
      // previous drag's write cannot land inside the assertion window.
      await ui.waitFor(`document.querySelector(${JSON.stringify(VIEW)})?.getAttribute('data-optimistic') === 'false'`, 'root group order persisted (optimistic queue settled)', waitMs);
      await ui.waitFor(`${expr} === ${JSON.stringify(JSON.stringify(expected))}`, `root group order ${expected.join(',')} after reconcile`, waitMs);
      return ui.rootGroupIds();
    },
    /**
     * Direct child group ids of `gid` in render order (empty when collapsed or
     * when the group has no child groups).
     */
    async groupChildren(gid) {
      return await evaluate(`(() => {
        const row = document.querySelector(${JSON.stringify(GROUP)} + '[data-group-id="' + ${JSON.stringify(gid)} + '"]');
        const wrap = row ? row.closest('.dsg-group') : null;
        const line = wrap ? wrap.querySelector(':scope > .dsg-group-body > .dsg-group-line') : null;
        if (!line) return [];
        return Array.from(line.querySelectorAll(':scope > .dsg-group'), (el) => {
          const childRow = el.querySelector(':scope > [data-testid="session-groups-group"]');
          return childRow ? childRow.getAttribute('data-group-id') : null;
        }).filter(Boolean);
      })()`);
    },
    async waitGroupChildren(gid, expected, waitMs = 8000) {
      const expr = `JSON.stringify(Array.from((() => {
        const row = document.querySelector(${JSON.stringify(GROUP)} + '[data-group-id="' + ${JSON.stringify(gid)} + '"]');
        const wrap = row ? row.closest('.dsg-group') : null;
        const line = wrap ? wrap.querySelector(':scope > .dsg-group-body > .dsg-group-line') : null;
        if (!line) return [];
        return Array.from(line.querySelectorAll(':scope > .dsg-group'), (el) => {
          const childRow = el.querySelector(':scope > [data-testid="session-groups-group"]');
          return childRow ? childRow.getAttribute('data-group-id') : null;
        }).filter(Boolean);
      })()))`;
      await ui.waitFor(`${expr} === ${JSON.stringify(JSON.stringify(expected))}`, `child groups of ${gid} = ${expected.join(',')}`, waitMs);
      await ui.waitFor(`document.querySelector(${JSON.stringify(VIEW)})?.getAttribute('data-optimistic') === 'false'`, `child groups of ${gid} persisted (optimistic queue settled)`, waitMs);
      await ui.waitFor(`${expr} === ${JSON.stringify(JSON.stringify(expected))}`, `child groups of ${gid} = ${expected.join(',')} after reconcile`, waitMs);
      return ui.groupChildren(gid);
    },
    async groupDepth(gid) {
      return Number(await evaluate(`document.querySelector(${JSON.stringify(GROUP)} + '[data-group-id="' + ${JSON.stringify(gid)} + '"]')?.getAttribute('data-depth') ?? -1`));
    },
    /**
     * Synthetic HTML5 drag of one or more group headers / body slots. All specs
     * are dispatched in one evaluate so "rapid" sequences queue their commits
     * before React can re-render the tree.
     * Spec: {kind:'before'|'after'|'middle', dragged, target}
     *     | {kind:'child', dragged, parentId, beforeGroupId}
     *     | {kind:'root-end', dragged}
     */
    async dragGroupMany(specs) {
      const result = await evaluate(`(() => {
        const specs = ${JSON.stringify(specs)};
        const groupRow = (gid) => document.querySelector(${JSON.stringify(GROUP)} + '[data-group-id="' + gid + '"]');
        const slotFor = (parentId, beforeGroupId) => Array.from(document.querySelectorAll(${JSON.stringify(GROUP_DROP)})).find((el) =>
          el.getAttribute('data-parent-id') === parentId &&
          (el.getAttribute('data-before-group-id') ?? '') === (beforeGroupId ?? ''));
        const results = [];
        for (const spec of specs) {
          const source = groupRow(spec.dragged);
          if (!source) { results.push({ ok: false, reason: 'source group missing', spec }); continue; }
          let target = null;
          let x = 0;
          let y = 0;
          if (spec.kind === 'before' || spec.kind === 'after' || spec.kind === 'middle') {
            target = groupRow(spec.target);
            if (target) {
              const rect = target.getBoundingClientRect();
              x = rect.left + rect.width / 2;
              const ratio = spec.kind === 'before' ? 0.2 : spec.kind === 'after' ? 0.8 : 0.5;
              y = rect.top + Math.max(2, rect.height * ratio);
            }
          } else if (spec.kind === 'child') {
            target = slotFor(spec.parentId, spec.beforeGroupId ?? null);
            if (target) {
              const rect = target.getBoundingClientRect();
              x = rect.left + rect.width / 2;
              y = rect.top + Math.max(1, rect.height / 2);
            }
          } else if (spec.kind === 'root-end') {
            target = document.querySelector(${JSON.stringify(UNGROUPED)});
            if (target) {
              const rect = target.getBoundingClientRect();
              x = rect.left + rect.width / 2;
              y = rect.top + Math.max(2, rect.height / 2);
            }
          }
          if (!target) { results.push({ ok: false, reason: 'drop target missing', spec }); continue; }
          const dt = new DataTransfer();
          source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
          for (const type of ['dragenter', 'dragover']) {
            target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
          }
          target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
          source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
          results.push({ ok: true, spec });
        }
        return results;
      })()`);
      const failed = result.find((entry) => !entry.ok);
      if (failed) throw new Error(`group drag failed: ${failed.reason} ${JSON.stringify(failed.spec)}`);
      return result;
    },
    async dragGroup(spec) {
      return ui.dragGroupMany([spec]);
    },
    /**
     * Real CDP pointer drag starting on a group `+` button and releasing over
     * another group header. Native HTML5 drag promises the dragstart on the
     * draggable row (not the button), which is exactly the dead-guard scenario:
     * the client must cancel it from the pointerdown origin. Returns every
     * dragstart seen (group id + defaultPrevented after React's handler ran).
     */
    async dragGroupFromButton(gid, targetGid, { ratio = 0.2 } = {}) {
      const start = await evaluate(`(() => {
        const button = document.querySelector(${JSON.stringify(GROUP_ADD)} + '[data-group-id="' + ${JSON.stringify(gid)} + '"]');
        if (!button) return null;
        // ui.click() scrolls targets into view; earlier menu steps can leave the
        // dragged root row clipped under the header. Centre it before measuring.
        button.scrollIntoView({ block: 'center' });
        const rect = button.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, rect: [rect.left, rect.top, rect.width, rect.height].map((n) => Math.round(n)) };
      })()`);
      if (!start) throw new Error(`group + button not found for ${gid}`);
      await sleep(150);
      const hit = await evaluate(`(() => {
        const button = document.querySelector(${JSON.stringify(GROUP_ADD)} + '[data-group-id="' + ${JSON.stringify(gid)} + '"]');
        const el = document.elementFromPoint(${Number(start.x)}, ${Number(start.y)});
        const topmost = el && typeof el.closest === 'function' ? el.closest('button') : null;
        return {
          ok: topmost === button,
          topmost: el ? (el.tagName + ':' + (el.getAttribute('data-testid') ?? el.className ?? '')) : null,
          stack: document.elementsFromPoint(${Number(start.x)}, ${Number(start.y)}).slice(0, 5).map((node) => node.tagName + ':' + (node.getAttribute('data-testid') ?? node.className ?? '')),
          button: button ? [button.getBoundingClientRect().left, button.getBoundingClientRect().top, button.getBoundingClientRect().width, button.getBoundingClientRect().height].map((n) => Math.round(n)) : null,
        };
      })()`);
      if (!hit?.ok) {
        throw new Error(`group + button is not the topmost element at its point (hit ${JSON.stringify(hit)}; start=${JSON.stringify(start)}); an overlay may be blocking real pointer input`);
      }
      const target = await evaluate(`(() => {
        const row = document.querySelector(${JSON.stringify(GROUP)} + '[data-group-id="' + ${JSON.stringify(targetGid)} + '"]');
        if (!row) return null;
        const rect = row.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + Math.max(2, rect.height * ${Number(ratio)}) };
      })()`);
      if (!target) throw new Error(`group header not found for ${targetGid}`);
      await evaluate(`(() => {
        window.__dsgGroupDragProbe = [];
        const handler = (event) => {
          const row = event.target && typeof event.target.closest === 'function'
            ? event.target.closest(${JSON.stringify(GROUP)})
            : null;
          window.__dsgGroupDragProbe.push({ gid: row ? row.getAttribute('data-group-id') : null, prevented: event.defaultPrevented === true });
        };
        document.addEventListener('dragstart', handler);
        window.__dsgGroupDragProbeCleanup = () => document.removeEventListener('dragstart', handler);
      })()`);
      const send = (type, x, y, buttons) => driver.cdp.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: 'left',
        buttons,
        clickCount: 1,
      }, driver.sessionId);
      await send('mousePressed', start.x, start.y, 1);
      const steps = 10;
      for (let step = 1; step <= steps; step++) {
        const x = start.x + ((target.x - start.x) * step) / steps;
        const y = start.y + ((target.y - start.y) * step) / steps;
        await send('mouseMoved', x, y, 1);
        await sleep(25);
      }
      await send('mouseReleased', target.x, target.y, 0);
      await sleep(700);
      return await evaluate(`(() => {
        const probe = window.__dsgGroupDragProbe ?? [];
        window.__dsgGroupDragProbeCleanup?.();
        delete window.__dsgGroupDragProbeCleanup;
        window.__dsgGroupDragProbe = [];
        return probe;
      })()`);
    },
    async openGroupMenu(gid) {
      await ui.click(`${GROUP_MENU}[data-group-id="${gid}"]`);
      await ui.waitFor(`!!document.querySelector(${JSON.stringify(MENU)})`, `group menu ${gid} open`, 5000);
      await sleep(120);
    },
    async menuControl(testid) {
      return await evaluate(`(() => {
        const el = document.querySelector('[data-testid="' + ${JSON.stringify(testid)} + '"]');
        if (!el) return { found: false };
        return {
          found: true,
          dataDisabled: el.getAttribute('data-disabled'),
          disabledAttr: el.hasAttribute('disabled'),
          groupId: el.getAttribute('data-group-id'),
          text: (el.textContent ?? '').trim(),
        };
      })()`);
    },
    async clickMenuControl(testid) {
      const clicked = await evaluate(`(() => {
        const el = document.querySelector('[data-testid="' + ${JSON.stringify(testid)} + '"]');
        if (!el) return false;
        el.click();
        return true;
      })()`);
      if (!clicked) throw new Error(`menu control not found: ${testid}`);
      await sleep(300);
    },
    async closeMenu() {
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
      await sleep(150);
      if (await ui.exists(MENU)) throw new Error('group menu did not close on Escape');
    },
    /**
     * Per-group body audit: direct slot count, direct child-group count and
     * whether any slot renders after a session row (slot placement contract).
     */
    async groupSlotAudit() {
      return await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(GROUP)}), (row) => {
        const gid = row.getAttribute('data-group-id');
        const wrap = row.closest('.dsg-group');
        const line = wrap ? wrap.querySelector(':scope > .dsg-group-body > .dsg-group-line') : null;
        if (!line) return { gid, expanded: false, slots: 0, children: 0, slotAfterSession: false };
        let seenSession = false;
        let slotAfterSession = false;
        let slots = 0;
        let children = 0;
        for (const el of Array.from(line.children)) {
          if (el.matches(${JSON.stringify(GROUP_DROP)})) {
            slots += 1;
            if (seenSession) slotAfterSession = true;
          } else if (el.matches(${JSON.stringify(SESSION)})) {
            seenSession = true;
          } else if (el.classList.contains('dsg-group')) {
            children += 1;
          }
        }
        return { gid, expanded: true, slots, children, slotAfterSession };
      })`);
    },
    async filterState() {
      return await evaluate(`document.querySelector(${JSON.stringify(FILTER_STATE)})?.getAttribute('data-filter') ?? null`);
    },
    async openViewOptions() {
      if (await ui.exists(VIEW_OPTIONS_POPOVER)) return true;
      await ui.click(VIEW_OPTIONS);
      await ui.waitFor(`!!document.querySelector(${JSON.stringify(VIEW_OPTIONS_POPOVER)})`, 'view options popover open', 5000);
      await sleep(120);
      return true;
    },
    async closeViewOptions() {
      if (!(await ui.exists(VIEW_OPTIONS_POPOVER))) return true;
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
      await ui.waitFor(`!document.querySelector(${JSON.stringify(VIEW_OPTIONS_POPOVER)})`, 'view options popover closed', 5000);
      return true;
    },
    async setFilter(target) {
      // Archive tri-state now lives in the view-options popover; each row has a
      // stable data-filter and closes the popover after dispatching.
      for (let attempt = 0; attempt < 4; attempt++) {
        if ((await ui.filterState()) === target) return true;
        await ui.openViewOptions();
        const clicked = await evaluate(`(() => {
          const option = document.querySelector(${JSON.stringify(ARCHIVE_OPTION)} + '[data-filter="' + ${JSON.stringify(target)} + '"]');
          if (!option) return false;
          option.click();
          return true;
        })()`);
        if (!clicked) {
          await ui.closeViewOptions();
          throw new Error(`archive option '${target}' not found in the view-options popover`);
        }
        await ui.waitFor(`!document.querySelector(${JSON.stringify(VIEW_OPTIONS_POPOVER)})`, 'view options closed after archive pick', 5000);
        await sleep(250);
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
    // --- session search helpers (step 15) -----------------------------------
    /**
     * Title of one session row. Reads `.dsg-session-title` (or the row
     * `aria-label`), never the full row text which appends the workspace badge.
     */
    async sessionTitle(sid) {
      return await evaluate(`(() => {
        const row = Array.from(document.querySelectorAll(${JSON.stringify(SESSION)}))
          .find((el) => el.getAttribute('data-session-id') === ${JSON.stringify(sid)});
        if (!row) return null;
        const titleElement = row.querySelector('.dsg-session-title');
        const text = (titleElement?.textContent ?? '').trim() || (row.getAttribute('aria-label') ?? '').trim();
        return text || null;
      })()`);
    },
    /** Id of the row marked as the main-view session (`data-current="true"`). */
    async currentSessionId() {
      return await evaluate(`document.querySelector(${JSON.stringify(SESSION)} + '[data-current="true"]')?.getAttribute('data-session-id') ?? null`);
    },
    async fillSearch(value) {
      if (!(await ui.exists(SEARCH))) {
        await ui.click(SEARCH_TOGGLE);
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(SEARCH)})`, 'search field expanded', 5000);
        await sleep(120);
      }
      await ui.setNativeValue(SEARCH, value);
      await sleep(180);
    },
    /** Collapse the header search field again (search is a toggle, not always visible). */
    async closeSearch() {
      if (!(await ui.exists(SEARCH))) return true;
      await ui.click(SEARCH_TOGGLE);
      await ui.waitFor(`!document.querySelector(${JSON.stringify(SEARCH)})`, 'search field collapsed', 5000);
      await sleep(150);
      return true;
    },
    async searchExpanded() {
      return await evaluate(`document.querySelector(${JSON.stringify(SEARCH)})?.getAttribute('aria-expanded') ?? null`);
    },
    /** Rendered search results (combobox listbox options). */
    async searchResults() {
      return await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(SEARCH_RESULT)}), (el) => ({
        sid: el.getAttribute('data-session-id'),
        archived: el.getAttribute('data-archived'),
        ariaDisabled: el.getAttribute('aria-disabled'),
        active: el.getAttribute('data-active') === 'true',
        text: (el.textContent ?? '').trim(),
      }))`);
    },
    /** Dispatch a keydown on the focused search input (React keyboard handler). */
    async pressSearchKey(key) {
      const pressed = await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(SEARCH)});
        if (!input) return false;
        input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
        return true;
      })()`);
      if (!pressed) throw new Error(`search input ${SEARCH} not found`);
      await sleep(120);
    },
    /** Geometry of the keyboard-active option relative to the scrolling listbox. */
    async searchActiveInfo() {
      return await evaluate(`(() => {
        const list = document.querySelector(${JSON.stringify(SEARCH_RESULTS)});
        const option = document.querySelector(${JSON.stringify(SEARCH_RESULT)} + '[data-active="true"]');
        if (!list || !option) return null;
        const listRect = list.getBoundingClientRect();
        const optionRect = option.getBoundingClientRect();
        return {
          sessionId: option.getAttribute('data-session-id'),
          inside: optionRect.top >= listRect.top - 0.5 && optionRect.bottom <= listRect.bottom + 0.5,
          scrollTop: list.scrollTop,
          clientHeight: list.clientHeight,
          scrollHeight: list.scrollHeight,
          listTop: listRect.top,
          listBottom: listRect.bottom,
          optionTop: optionRect.top,
          optionBottom: optionRect.bottom,
        };
      })()`);
    },
    async treeScrollTop() {
      return Number(await evaluate(`document.querySelector(${JSON.stringify(TREE)})?.scrollTop ?? NaN`));
    },
    async setTreeScrollTop(value) {
      return Number(await evaluate(`(() => {
        const tree = document.querySelector(${JSON.stringify(TREE)});
        if (!tree) return NaN;
        tree.scrollTop = ${Number(value)};
        return tree.scrollTop;
      })()`));
    },
    /** Outside pointerdown closes the search dropdown (spec §3.3). */
    async clickOutsideSearch() {
      await evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))`);
      await sleep(180);
    },
  };
  return ui;
}

// ---------------------------------------------------------------------------
// steps
// ---------------------------------------------------------------------------
function makeSteps({ driver, ui, evidenceDir, args, state }) {
  const evaluate = (expression, options) => driver.evaluate(expression, options);
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
        if (await ui.exists('[data-testid="session-groups-return"]')) {
          throw new Error('the normal header must not render a 返回工作区 button (error fallback only)');
        }
        // Single 28px footer button (0.2.3): icon + label describe the target
        // view, so both change after the click; the active mode lives in
        // data-mode / aria-pressed. The removed 0.2.2 segments must not exist.
        const readToggle = () => driver.evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(TOGGLE)});
          if (!el) return null;
          const style = getComputedStyle(el);
          const svg = el.querySelector('svg');
          const rect = svg ? svg.getBoundingClientRect() : null;
          return {
            tag: el.tagName,
            text: (el.textContent ?? '').trim(),
            title: el.getAttribute('title'),
            label: el.getAttribute('aria-label'),
            pressed: el.getAttribute('aria-pressed'),
            mode: el.getAttribute('data-mode'),
            target: el.getAttribute('data-target'),
            height: el.getBoundingClientRect().height,
            fontSize: Number.parseFloat(style.fontSize),
            iconWidth: rect ? rect.width : null,
            iconHeight: rect ? rect.height : null,
            glyphPath: svg ? (svg.innerHTML ?? '').slice(0, 160) : null,
          };
        })()`);
        const toggle = await readToggle();
        if (!toggle) throw new Error(`footer toggle ${TOGGLE} missing`);
        if (toggle.tag !== 'BUTTON') throw new Error(`footer toggle must be a single button, got ${toggle.tag}`);
        if (toggle.mode !== 'workspace' || toggle.pressed !== 'false') {
          throw new Error(`footer initial state expected workspace/unpressed, got ${toggle.mode}/${toggle.pressed}`);
        }
        if (!/^(切换到自由分组视图|Switch to free grouping view)$/.test(toggle.text) || !/^(切换到自由分组视图|Switch to free grouping view)$/.test(toggle.title ?? '')) {
          throw new Error(`footer initial label/title must be exactly 切换到自由分组视图 / Switch to free grouping view: ${JSON.stringify(toggle)}`);
        }
        if (Math.abs(toggle.height - 28) > 1) throw new Error(`footer toggle height expected 28 ±1, got ${toggle.height}`);
        if (Math.abs(toggle.fontSize - 13) > 0.6) throw new Error(`footer toggle font-size expected 13px, got ${toggle.fontSize}`);
        if (Math.abs(toggle.iconWidth - 16) > 0.6 || Math.abs(toggle.iconHeight - 16) > 0.6) {
          throw new Error(`footer toggle icon expected 16x16, got ${toggle.iconWidth}x${toggle.iconHeight}`);
        }
        if (await ui.exists('[data-testid="session-groups-toggle-groups"]') || await ui.exists('[data-testid="session-groups-toggle-workspace"]')) {
          throw new Error('the 0.2.2 two-segment footer must be gone');
        }
        // Click -> groups: every visible facet flips.
        await ui.click(TOGGLE);
        await ui.waitGroupsView();
        const groupsToggle = await readToggle();
        if (groupsToggle.mode !== 'groups' || groupsToggle.pressed !== 'true') {
          throw new Error(`footer after click expected groups/pressed, got ${groupsToggle.mode}/${groupsToggle.pressed}`);
        }
        if (!/^(返回默认工作区视图|Back to default workspace view)$/.test(groupsToggle.text) || !/^(返回默认工作区视图|Back to default workspace view)$/.test(groupsToggle.title ?? '')) {
          throw new Error(`footer label/title must be exactly 返回默认工作区视图 / Back to default workspace view after the click: ${JSON.stringify(groupsToggle)}`);
        }
        if (groupsToggle.glyphPath === toggle.glyphPath) throw new Error('footer glyph must change with the target view');
        // Click again -> official workspace, label/icon back to the groups target.
        await ui.click(TOGGLE);
        await ui.waitWorkspaceView();
        const backToggle = await readToggle();
        if (backToggle.mode !== 'workspace' || backToggle.pressed !== 'false') {
          throw new Error(`footer after second click expected workspace/unpressed, got ${backToggle.mode}/${backToggle.pressed}`);
        }
        if (backToggle.text !== toggle.text || backToggle.glyphPath !== toggle.glyphPath) {
          throw new Error(`footer did not restore its initial label/icon: ${JSON.stringify(backToggle)}`);
        }
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
        return { mode: mode[0], workspaceTitles: titles, footer: { initial: toggle, groups: groupsToggle, back: backToggle } };
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
        // Fresh cold starts deliver the host session snapshot asynchronously; an
        // immediate count against a half-hydrated tree reports zero (same class
        // of flake step 10 guards against with its restart hydration wait).
        await ui.waitFor(
          `document.querySelectorAll(${JSON.stringify(SESSION)}).length > 0`,
          'groups view session rows hydrated',
          30000,
        );
        const sessions = await ui.sessions();
        if (sessions.length === 0) throw new Error('groups view rendered zero session rows');
        const groups = await ui.groups();
        if (groups.length > 0) throw new Error('fresh isolated home should start with zero groups');
        // Header right side: search, view-options, plus (official workspace
        // section order), 28x28 with 16px glyphs; search fields stay collapsed
        // until the search icon opens them, and the old 返回工作区 button is gone.
        const header = await driver.evaluate(`(() => {
          const root = document.querySelector(${JSON.stringify(HEADER)});
          const buttons = Array.from(root?.querySelectorAll('button') ?? [], (el) => ({
            id: el.getAttribute('data-testid'),
            width: el.getBoundingClientRect().width,
            height: el.getBoundingClientRect().height,
            glyph: (() => { const svg = el.querySelector('svg'); const rect = svg?.getBoundingClientRect(); return rect ? { width: rect.width, height: rect.height } : null; })(),
          }));
          return {
            buttons,
            title: (root?.querySelector('.dsg-header-title')?.textContent ?? '').trim(),
            searchVisible: !!document.querySelector(${JSON.stringify(SEARCH)}),
            returnVisible: !!root?.querySelector('[data-testid="session-groups-return"]'),
          };
        })()`);
        const expectedOrder = ['session-groups-search-toggle', 'session-groups-view-options', 'session-groups-new-group'];
        const actualOrder = header.buttons.map((button) => button.id);
        if (JSON.stringify(actualOrder) !== JSON.stringify(expectedOrder)) {
          throw new Error(`groups header actions expected ${JSON.stringify(expectedOrder)}, got ${JSON.stringify(actualOrder)}`);
        }
        for (const button of header.buttons) {
          if (Math.abs(button.width - 28) > 1 || Math.abs(button.height - 28) > 1) {
            throw new Error(`${button.id} expected 28x28, got ${button.width}x${button.height}`);
          }
          if (!button.glyph || Math.abs(button.glyph.width - 16) > 0.6 || Math.abs(button.glyph.height - 16) > 0.6) {
            throw new Error(`${button.id} glyph expected 16x16, got ${JSON.stringify(button.glyph)}`);
          }
        }
        if (!/分组|Groups/.test(header.title)) throw new Error(`header title expected 分组/Groups, got ${JSON.stringify(header.title)}`);
        if (header.searchVisible) throw new Error('search field must stay collapsed until the search icon is clicked');
        if (header.returnVisible) throw new Error('normal header must not render the 返回工作区 button');
        // View-options popover: three 30px archive rows, active check, Escape and
        // outside pointerdown both close it (feedback item 3).
        await ui.openViewOptions();
        const options = await driver.evaluate(`(() => {
          const popover = document.querySelector(${JSON.stringify(VIEW_OPTIONS_POPOVER)});
          const rows = Array.from(document.querySelectorAll(${JSON.stringify(ARCHIVE_OPTION)}), (row) => ({
            filter: row.getAttribute('data-filter'),
            active: row.getAttribute('data-active'),
            height: row.getBoundingClientRect().height,
            text: (row.textContent ?? '').trim(),
            check: !!row.querySelector('svg'),
          }));
          return {
            popover: !!popover,
            buttonExpanded: document.querySelector(${JSON.stringify(VIEW_OPTIONS)})?.getAttribute('aria-expanded'),
            rows,
          };
        })()`);
        if (!options.popover || options.buttonExpanded !== 'true') {
          throw new Error(`view-options popover did not open (${JSON.stringify(options)})`);
        }
        if (options.rows.length !== 3) throw new Error(`view-options popover must expose 3 archive rows, got ${options.rows.length}`);
        const expectedFilters = ['hidden', 'all', 'only'];
        if (JSON.stringify(options.rows.map((row) => row.filter)) !== JSON.stringify(expectedFilters)) {
          throw new Error(`archive row order expected ${JSON.stringify(expectedFilters)}, got ${JSON.stringify(options.rows.map((row) => row.filter))}`);
        }
        const labelPatterns = [/隐藏已归档|Hide archived/, /全部对话（显示已归档）|All conversations \(archived shown\)/, /仅显示已归档|Archived only/];
        options.rows.forEach((row, index) => {
          if (!labelPatterns[index].test(row.text)) throw new Error(`archive row ${row.filter} label mismatch: ${JSON.stringify(row.text)}`);
          if (Math.abs(row.height - 30) > 1) throw new Error(`archive row ${row.filter} height expected 30 ±1, got ${row.height}`);
          if ((row.filter === 'hidden') !== row.check) throw new Error(`archive row ${row.filter} check visibility mismatch (${row.check})`);
        });
        await ui.closeViewOptions();
        await ui.openViewOptions();
        await driver.evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))`);
        await ui.waitFor(`!document.querySelector(${JSON.stringify(VIEW_OPTIONS_POPOVER)})`, 'view-options closed on an outside pointerdown', 5000);
        if ((await ui.attrs(VIEW_OPTIONS, 'aria-expanded'))[0] !== 'false') throw new Error('view-options button must report aria-expanded=false after closing');
        return { sessions: sessions.length, groups: groups.length, header, options };
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
        const logicalBefore = await ui.ungroupedCount();
        if (!(logicalBefore >= 10)) throw new Error(`fixtures expose only ${logicalBefore} logical ungrouped sessions; need >=10 for the 10-session drag step`);
        // Virtualization renders the viewport + overscan only; the logical count
        // comes from the section header, while the drag sources are visible rows.
        const before = await ui.ungroupedSessionIds();
        if (before.length < 10) throw new Error(`fixtures expose only ${before.length} rendered ungrouped session rows; need >=10 for the 10-session drag step`);
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
        const logicalAfter = await ui.ungroupedCount();
        if (logicalAfter !== logicalBefore - 10) {
          throw new Error(`logical ungrouped count ${logicalBefore} -> ${logicalAfter}, expected -10`);
        }
        const ungroupedAfter = await ui.ungroupedSessionIds();
        state.dragged = plan;
        return {
          moved: plan.length,
          ungroupedBefore: logicalBefore,
          ungroupedAfter: logicalAfter,
          renderedBefore: before.length,
          renderedAfter: ungroupedAfter.length,
        };
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
        // Rename the LAST real candidate in group A (oldest in the rendered
        // order), not the newest: the newest session can be the one the host is
        // still projecting/resuming in the isolated home, and renaming it can
        // block the renderer for a long time independently of this plugin
        // (verified by renaming it through the official workspace menu only).
        // Any real session exercises the same host rename + snapshot sync path.
        const groupAReal = rows.filter((row) => realFirst(row) && row.groupId === state.groups.a);
        const anyReal = rows.filter(realFirst);
        const candidates = [
          groupAReal[groupAReal.length - 1],
          anyReal[anyReal.length - 1],
          rows.filter((row) => usable(row) && row.groupId === state.groups.a).at(-1),
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
        const railFooter = await driver.evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(TOGGLE)});
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          const svg = el.querySelector('svg');
          const svgRect = svg ? svg.getBoundingClientRect() : null;
          return {
            width: rect.width,
            height: rect.height,
            text: (el.textContent ?? '').trim(),
            wide: el.getAttribute('data-wide'),
            mode: el.getAttribute('data-mode'),
            title: el.getAttribute('title'),
            icon: svgRect ? { width: svgRect.width, height: svgRect.height } : null,
          };
        })()`);
        if (railFooter) {
          if (Math.abs(railFooter.width - 28) > 1 || Math.abs(railFooter.height - 28) > 1) {
            throw new Error(`rail footer must be a 28x28 icon-only button, got ${JSON.stringify(railFooter)}`);
          }
          if (railFooter.text !== '') throw new Error(`rail footer must hide its label, got ${JSON.stringify(railFooter.text)}`);
          if (railFooter.wide !== 'false') throw new Error(`rail footer must report data-wide="false", got ${railFooter.wide}`);
          if (Math.abs(railFooter.icon?.width - 16) > 0.6 || Math.abs(railFooter.icon?.height - 16) > 0.6) {
            throw new Error(`rail footer icon expected 16x16, got ${JSON.stringify(railFooter.icon)}`);
          }
        } else {
          throw new Error(`footer toggle missing in rail mode`);
        }
        if (hasExpand) {
          await ui.click(RAIL_EXPAND);
          await sleep(500);
          if (!(await ui.exists(VIEW))) throw new Error('rail expand did not restore the groups view');
        }
        return { rail: hasRail, expand: hasExpand, footer: railFooter };
      },
    },
    {
      id: 10,
      name: 'restart-preserves-structure',
      async run() {
        const beforeRows = await ui.sessions();
        const beforeGroups = await ui.groups();
        const beforeFilter = await ui.filterState();
        const isBlankRow = (row) => /新会话/.test(row.text || '') || row.sid === state.createdSession;
        const beforeOrder = beforeRows.filter((row) => row.groupId === state.groups.a && !isBlankRow(row)).map((row) => row.sid);
        const beforeBlankActive = beforeRows.filter((row) => isBlankRow(row) && row.groupId === state.groups.a).map((row) => row.sid);
        // Grouped rows are always rendered. The ungrouped section is virtualized
        // (0.2.3+): only the viewport + overscan window exists in the DOM, so the
        // number of *visible session rows* is not a stable logical count across a
        // restart — a different scroll offset or placeholder geometry can shift the
        // window by a row (0.2.4 QA saw 26 after vs 27 before on a fresh home).
        // Assert the real invariants instead: every grouped row must come back,
        // the known session must hydrate, and the ungrouped window must contain a
        // reasonable floor of rows (never zero / never a half-hydrated tree).
        const beforeGroupedIds = beforeRows.filter((row) => row.groupId !== null).map((row) => row.sid);
        const sessionRowFloor = Math.max(1, Math.min(beforeRows.length, 20));
        // A row that must be visible again after hydration (any non-blank row).
        const knownSession = (beforeOrder[0] ?? beforeRows.find((row) => !isBlankRow(row))?.sid) ?? null;
        await restartServer();
        const mode = (await ui.attrs(TOGGLE, 'data-mode'))[0] ?? null;
        if (mode !== 'groups') await ui.toggleMode();
        await ui.waitGroupsView();
        // The QA fixture has grown to ~1.3 GB / ~1476 files, so the restarted
        // server can take well over the old fixed 500 ms to deliver the session
        // snapshot. Wait for the expected group rows, all grouped session rows,
        // the known session and the ungrouped virtual window floor before
        // comparing names/order; otherwise the counts render as 0 against a
        // half-hydrated tree.
        const snapshotWaitMs = 30000;
        const snapshotDeadline = Date.now() + snapshotWaitMs;
        let snapshot = { groups: -1, rows: -1 };
        for (;;) {
          const groupsNow = await ui.groups();
          const rowsNow = await ui.sessions();
          const idsNow = new Set(rowsNow.map((row) => row.sid));
          snapshot = { groups: groupsNow.length, rows: rowsNow.length };
          const groupsReady = groupsNow.length === beforeGroups.length;
          const groupedReady = beforeGroupedIds.every((sid) => idsNow.has(sid));
          // Virtualized ungrouped rows outside the window deliberately need not be
          // in the DOM; the floor only proves the list hydrated past the initial
          // paint, not that a particular window boundary survived the restart.
          const rowsReady = rowsNow.length > 0 && rowsNow.length >= sessionRowFloor;
          const knownReady = knownSession === null || idsNow.has(knownSession);
          if (groupsReady && groupedReady && rowsReady && knownReady) break;
          if (Date.now() >= snapshotDeadline) {
            throw new Error(
              `restarted server did not deliver the session snapshot within ${snapshotWaitMs}ms: ` +
                `groups ${snapshot.groups}/${beforeGroups.length}, ` +
                `visible session rows ${snapshot.rows} (floor ${sessionRowFloor}, virtualized ungrouped window), ` +
                `grouped rows missing ${JSON.stringify(beforeGroupedIds.filter((sid) => !idsNow.has(sid)))}, ` +
                `known session ${JSON.stringify(knownSession)} present=${knownReady}`
            );
          }
          await sleep(250);
        }
        const afterGroups = await ui.groups();
        if (afterGroups.length !== beforeGroups.length) {
          throw new Error(`groups count changed across restart: ${beforeGroups.length} -> ${afterGroups.length}`);
        }
        const beforeByName = beforeGroups.map((group) => group.text).sort();
        const afterByName = afterGroups.map((group) => group.text).sort();
        if (JSON.stringify(beforeByName) !== JSON.stringify(afterByName)) {
          throw new Error(
            `group names changed across restart: before=${JSON.stringify(beforeByName)} ` +
              `after=${JSON.stringify(afterByName)} (visible session rows ${beforeRows.length} -> ${(await ui.sessions()).length})`
          );
        }
        const actual = (await ui.sessions()).filter((row) => row.groupId === state.groups.a && !isBlankRow(row)).map((row) => row.sid);
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
        const afterRowsNow = await ui.sessions();
        return {
          groups: afterGroups.length,
          filter: afterFilter,
          sessionRows: {
            before: beforeRows.length,
            after: afterRowsNow.length,
            floor: sessionRowFloor,
            grouped: beforeGroupedIds.length,
            virtualized: true,
          },
          blankLifecycle,
        };
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
        // Mount at 1024px (the host is still wide at exactly 1024) with a stored
        // 620px: the applied width is the 544px clamp for that viewport. Widening
        // to 1440px must re-clamp against the LIVE viewport (620), and a following
        // drag must reach the 760px maximum instead of staying at the mount cap.
        await driver.evaluate(`localStorage.setItem(${JSON.stringify(SIDEBAR_WIDTH_KEY)}, '620')`);
        await ui.setViewport(1024);
        await ui.toggleMode();
        await ui.waitGroupsView();
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(RESIZE_HANDLE)})`, 'resize handle mounts at 1024px');
        if (!(await overrideMarker())) throw new Error('width override marker missing after mounting the groups view');
        if (await ui.officialHandleVisible()) throw new Error('official sidebar handle must be hidden while the width override is active');
        const mountedNarrow = await waitWidth(544, 'width after mounting at 1024px with the stored 620');
        await ui.setViewport(1440);
        const widened = await waitWidth(620, 'width after widening to 1440px');
        // A late-mounting onboarding dialog covers the handle's hit area.
        await ui.closeOnboarding(1500);
        await ui.dragResizeHandle(760);
        const maxDrag = await waitWidth(760, 'width after dragging to 760 at 1440px');
        await ui.closeOnboarding(1000);
        await ui.dragResizeHandle(620);
        await waitWidth(620, 'width after dragging back to 620');

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
          if (!el) return null;
          const toggle = document.querySelector(${JSON.stringify(TOGGLE)});
          const toggleRect = toggle ? toggle.getBoundingClientRect() : null;
          const svg = toggle ? toggle.querySelector('svg') : null;
          const svgRect = svg ? svg.getBoundingClientRect() : null;
          return {
            clientWidth: el.clientWidth,
            scrollWidth: el.scrollWidth,
            height: el.getBoundingClientRect().height,
            searchOpen: el.getAttribute('data-search-open'),
            footer: toggle ? {
              mode: toggle.getAttribute('data-mode'),
              pressed: toggle.getAttribute('aria-pressed'),
              text: (toggle.textContent ?? '').trim(),
              title: toggle.getAttribute('title'),
              width: toggleRect.width,
              height: toggleRect.height,
              wide: toggle.getAttribute('data-wide'),
              icon: svgRect ? { width: svgRect.width, height: svgRect.height } : null,
            } : null,
          };
        })()`);
        if (!header) throw new Error('groups header is missing at 264px');
        if (header.scrollWidth > header.clientWidth + 1) {
          throw new Error(`groups header overflows horizontally at 264px: scrollWidth ${header.scrollWidth} > clientWidth ${header.clientWidth}`);
        }
        if (Math.abs(header.height - 36) > 1) throw new Error(`groups header height expected 36 ±1 at 264px, got ${header.height}`);
        if (header.searchOpen !== 'false') throw new Error(`search must start collapsed at 264px, got data-search-open=${header.searchOpen}`);
        if (!header.footer || !(header.footer.width > 0) || !header.footer.text) {
          throw new Error(`the single labelled footer button must stay visible at 264px, got ${JSON.stringify(header.footer)}`);
        }
        if (Math.abs(header.footer.height - 28) > 1 || Math.abs(header.footer.icon?.width - 16) > 0.6 || Math.abs(header.footer.icon?.height - 16) > 0.6) {
          throw new Error(`footer metrics at 264px expected 28px high / 16px icon, got ${JSON.stringify(header.footer)}`);
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

        // Fast release (D): pointerup commits while the last move's rAF may still
        // be pending. The applied width must match the persisted width, otherwise
        // a later reload would jump to a width the sidebar never took.
        await ui.closeOnboarding(1000);
        await ui.dragResizeHandleFast(500);
        const fastApplied = await waitWidth(500, 'width after a fast-release drag to 500');
        await sleep(250);
        const fastStored = Number(await driver.evaluate(`localStorage.getItem(${JSON.stringify(SIDEBAR_WIDTH_KEY)})`));
        if (!(Number.isFinite(fastStored) && Math.abs(fastStored - fastApplied) <= 2)) {
          throw new Error(`fast release persisted ${fastStored}px but applied ${fastApplied}px`);
        }

        // Width reset at a narrow viewport (C): the preference must stay 420, not
        // the 320px clamp for 800px, so widening back restores 420.
        await ui.setViewport(800);
        await sleep(400);
        if (await ui.exists(RAIL_EXPAND)) {
          await ui.click(RAIL_EXPAND);
          await sleep(600);
        }
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(RESIZE_HANDLE)})`, 'resize handle at 800px', 8000);
        await ui.doubleClickResizeHandle();
        const narrowReset = await waitWidth(320, 'width after resetting at 800px (clamped preference)');
        const narrowStored = await driver.evaluate(`localStorage.getItem(${JSON.stringify(SIDEBAR_WIDTH_KEY)})`);
        if (narrowStored !== '420') {
          throw new Error(`reset at 800px must persist the 420 preference, got ${JSON.stringify(narrowStored)}`);
        }
        await ui.resetViewport();
        await sleep(400);
        if (await ui.exists(RAIL_EXPAND)) {
          await ui.click(RAIL_EXPAND);
          await sleep(600);
        }
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(RESIZE_HANDLE)})`, 'resize handle after widening back', 8000);
        const widenedReset = await waitWidth(420, 'width after widening back from the narrow reset');
        const widenedStored = await driver.evaluate(`localStorage.getItem(${JSON.stringify(SIDEBAR_WIDTH_KEY)})`);
        if (widenedStored !== '420') {
          throw new Error(`widened sidebar preference expected "420", got ${JSON.stringify(widenedStored)}`);
        }

        // Back to the official view: handle gone, no override, width restored.
        await ui.toggleMode();
        await ui.waitWorkspaceView();
        await ui.waitFor(`!document.querySelector(${JSON.stringify(RESIZE_HANDLE)})`, 'resize handle removed in workspace view');
        await sleep(400);
        if (await overrideMarker()) throw new Error('width override marker must be cleared in the workspace view');
        const officialRestored = await ui.sidebarWidth();
        assertNear(officialRestored, official, 'official sidebar width after switch-back');
        if (!(await ui.officialHandleVisible())) throw new Error('official sidebar handle must be restored after returning to the official view');
        return {
          official,
          mountedNarrow,
          widened,
          maxDrag,
          reloaded,
          narrow,
          restored,
          reset,
          minimum,
          persistedMinimum,
          fastRelease: { applied: fastApplied, stored: fastStored },
          narrowReset: { applied: narrowReset, stored: narrowStored },
          widenedReset: { applied: widenedReset, stored: widenedStored },
          officialRestored,
          header,
        };
      },
    },
    {
      id: 14,
      name: 'drag-groups-reorder-and-reparent',
      async run() {
        // Step 13 leaves the official workspace view active; step 15 expects the
        // groups view, so step 14 owns the toggle back in.
        await ui.toggleMode();
        await ui.waitGroupsView();
        await sleep(500);

        const { a, b, c } = state.groups;
        if (!a || !b || !c) throw new Error('step 14 needs groups a/b/c from step 3');
        const bSessionsBefore = await ui.sessionIdsInGroup(b);
        if (bSessionsBefore.length === 0) throw new Error('group b must have sessions before the group-drag step');
        const bChildrenBefore = await ui.groupChildren(b);
        if (bChildrenBefore.length !== 0) throw new Error(`group b must have zero child groups before step 14, got ${JSON.stringify(bChildrenBefore)}`);

        const e = await ui.createGroup('空组E');
        const f = await ui.createGroup('空组F');
        if (!e || !f) throw new Error('could not create groups e/f');
        const initialOrder = await ui.waitRootGroups([a, b, c, e, f], 10000);

        const recordRevision = () => {
          try {
            const record = JSON.parse(readFileSync(join(QA_HOME, 'storages', 'dsh-session-groups.json'), 'utf8'));
            return Number(record.revision);
          } catch {
            return -1;
          }
        };
        /** groupId -> parentId map from the record (used by the button-guard check). */
        const recordParents = () => {
          try {
            const record = JSON.parse(readFileSync(join(QA_HOME, 'storages', 'dsh-session-groups.json'), 'utf8'));
            return Object.fromEntries((record.groups ?? []).map((group) => [group.id, group.parentId ?? null]));
          } catch {
            return {};
          }
        };

        // (1) B6: c into the body slot of b (b has sessions but zero child groups).
        await ui.dragGroup({ kind: 'child', dragged: c, parentId: b, beforeGroupId: null });
        await ui.waitGroupChildren(b, [c]);
        const cDepthInB = await ui.groupDepth(c);
        if (cDepthInB !== (await ui.groupDepth(b)) + 1) {
          throw new Error(`c should render one level below b after the body-slot drop (b=${await ui.groupDepth(b)}, c=${cDepthInB})`);
        }

        // (2) drag c back out before reusing it in the rapid child-slot drag.
        await ui.dragGroup({ kind: 'before', dragged: c, target: b });
        await ui.waitGroupChildren(b, []);
        await ui.waitRootGroups([a, c, b, e, f]);

        // (3) B6 empty group: a (with its own child subtree) into empty group e.
        await ui.dragGroup({ kind: 'child', dragged: a, parentId: e, beforeGroupId: null });
        await ui.waitGroupChildren(e, [a]);
        await ui.waitRootGroups([c, b, e, f]);
        const aDepthInE = await ui.groupDepth(a);
        if (aDepthInE !== (await ui.groupDepth(e)) + 1) throw new Error('a should become a child of empty group e');
        if (state.groups.child && (await ui.groupDepth(state.groups.child)) !== aDepthInE + 1) {
          throw new Error('a subtree depth did not follow a into e');
        }

        // (4) Root-end via the ungrouped header: c is the first root, so this is
        // a real move (a generic `index >= count` no-op shortcut would wrongly
        // skip it) and c must end up parentId=null at the root end.
        await ui.dragGroup({ kind: 'root-end', dragged: c });
        await ui.waitRootGroups([b, e, f, c]);

        // (5) Drag a root group (a) to b's top edge: extract it from e and change
        // the root order.
        await ui.dragGroup({ kind: 'before', dragged: a, target: b });
        await ui.waitRootGroups([a, b, e, f, c]);
        await ui.waitGroupChildren(e, []);

        // (6) B5 rapid double drag: after/before targets are resolved inside the
        // serialized commit queue, so the second drop must use the latest doc.
        // A stale precomputed index would end at [b,c,a,e,f], not [c,b,a,e,f].
        await ui.dragGroupMany([
          { kind: 'after', dragged: a, target: b },
          { kind: 'before', dragged: c, target: b },
        ]);
        const afterRapid = await ui.waitRootGroups([c, b, a, e, f]);

        // (7) B5 rapid double drag into the same child slot anchor. The slot is
        // captured as {parentId:b, beforeGroupId:null}; after f lands, the second
        // drag must re-resolve to index 1 (f before c), not reuse index 0.
        await ui.dragGroupMany([
          { kind: 'child', dragged: f, parentId: b, beforeGroupId: null },
          { kind: 'child', dragged: c, parentId: b, beforeGroupId: null },
        ]);
        await ui.waitRootGroups([b, a, e]);
        const rapidChildren = await ui.waitGroupChildren(b, [f, c], 10000);

        // (8) Drag a to b's top edge: root order changes again.
        await ui.dragGroup({ kind: 'before', dragged: a, target: b });
        await ui.waitRootGroups([a, b, e]);

        // (9) Self drop: b onto its own top edge is invalid and must not commit.
        const revisionBeforeNoop = recordRevision();
        await ui.dragGroup({ kind: 'before', dragged: b, target: b });
        await sleep(700);
        await ui.waitRootGroups([a, b, e]);
        const revisionAfterSelf = recordRevision();
        if (revisionAfterSelf !== revisionBeforeNoop) {
          throw new Error(`self group drop committed a no-op revision (${revisionBeforeNoop} -> ${revisionAfterSelf})`);
        }

        // (9b) root-end when e is already the last root: special-cased no-op.
        await ui.dragGroup({ kind: 'root-end', dragged: e });
        await sleep(700);
        await ui.waitRootGroups([a, b, e]);
        const revisionAfterRootEnd = recordRevision();
        if (revisionAfterRootEnd !== revisionAfterSelf) {
          throw new Error(`root-end for the last root committed a no-op revision (${revisionAfterSelf} -> ${revisionAfterRootEnd})`);
        }

        // (10) Group menu move-up/move-down with first/last disabled states.
        await ui.openGroupMenu(a);
        const firstUp = await ui.menuControl(GROUP_MOVE_UP);
        if (!firstUp.found) throw new Error('group menu has no move-up item');
        if (firstUp.dataDisabled !== 'true' || !firstUp.disabledAttr) {
          throw new Error(`move-up must be disabled for the first root group (state=${JSON.stringify(firstUp)})`);
        }
        if (firstUp.groupId !== a) throw new Error(`move-up data-group-id expected ${a}, got ${firstUp.groupId}`);
        await ui.closeMenu();

        // Reopen (the disabled click closed nothing) and move a down one slot.
        await ui.openGroupMenu(a);
        await ui.clickMenuControl(GROUP_MOVE_DOWN);
        const afterMoveDown = await ui.waitRootGroups([b, a, e]);
        if (await ui.exists(MENU)) throw new Error('group menu must close after move-down');
        if (JSON.stringify(afterMoveDown) !== JSON.stringify([b, a, e])) throw new Error('move-down did not reorder root groups');

        // Last root group: move-down disabled, move-up enabled.
        await ui.openGroupMenu(e);
        const lastDown = await ui.menuControl(GROUP_MOVE_DOWN);
        const lastUp = await ui.menuControl(GROUP_MOVE_UP);
        if (!lastDown.found) throw new Error('group menu has no move-down item');
        if (lastDown.dataDisabled !== 'true' || !lastDown.disabledAttr) {
          throw new Error(`move-down must be disabled for the last root group (state=${JSON.stringify(lastDown)})`);
        }
        if (lastDown.groupId !== e) throw new Error(`move-down data-group-id expected ${e}, got ${lastDown.groupId}`);
        if (lastUp.dataDisabled === 'true') throw new Error('move-up must stay enabled for the last (non-first) root group');
        // Enabled move-up path: e (last root) moves one slot up to [b, e, a].
        await ui.clickMenuControl(GROUP_MOVE_UP);
        await ui.waitRootGroups([b, e, a]);
        if (await ui.exists(MENU)) throw new Error('group menu must close after move-up');

        // (10b) Middle 50% of a group header is an invalid drop for a group drag
        // (it must not fall through to a session-append or commit anything).
        const revisionBeforeMiddle = recordRevision();
        // A previous invalid drop can leave the same "cannot drop" toast on
        // screen for up to 2.6s. Wait for it to expire so this assertion
        // observes THIS drop's toast instead of a stale copy of the same text.
        await ui.waitFor(`!document.querySelector(${JSON.stringify(TOAST)})`, 'previous toast cleared before the middle-zone drop', 4000).catch(() => undefined);
        await ui.dragGroup({ kind: 'middle', dragged: b, target: a });
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(TOAST)})`, 'middle-zone invalid-drop toast rendered', 3000);
        await sleep(200);
        await ui.waitRootGroups([b, e, a]);
        const revisionAfterMiddle = recordRevision();
        if (revisionAfterMiddle !== revisionBeforeMiddle) {
          throw new Error(`middle-zone group drop committed a revision (${revisionBeforeMiddle} -> ${revisionAfterMiddle})`);
        }
        const toastAfterMiddle = await ui.text(TOAST);
        if (!/不能放入|Cannot drop/i.test(toastAfterMiddle)) {
          throw new Error(`middle-zone group drop should surface the invalid-drop toast, got ${JSON.stringify(toastAfterMiddle)}`);
        }

        // (10c) Generic same-position no-op: a is already the last root, so
        // dropping it after e resolves to its current index and must not commit.
        const revisionBeforeSame = recordRevision();
        await ui.dragGroup({ kind: 'after', dragged: a, target: e });
        await sleep(700);
        await ui.waitRootGroups([b, e, a]);
        const revisionAfterSame = recordRevision();
        if (revisionAfterSame !== revisionBeforeSame) {
          throw new Error(`same-position group drop committed a revision (${revisionBeforeSame} -> ${revisionAfterSame})`);
        }

        // (10) Body slot contract across the whole tree: n child groups => n+1
        // direct slots, and no slot is ever rendered after a session row.
        const slotAudit = await ui.groupSlotAudit();
        for (const entry of slotAudit) {
          if (!entry.expanded) continue;
          if (entry.slots !== entry.children + 1) {
            throw new Error(`group ${entry.gid} renders ${entry.slots} body slots for ${entry.children} child groups (expected ${entry.children + 1})`);
          }
          if (entry.slotAfterSession) throw new Error(`group ${entry.gid} renders a child slot after a session row`);
        }
        const childGroupsAudit = await ui.groupChildren(a);
        if (state.groups.child && !childGroupsAudit.includes(state.groups.child)) {
          throw new Error('original child group did not follow a through reparenting');
        }
        const bSessionsAfter = await ui.sessionIdsInGroup(b);
        if (bSessionsAfter.length !== bSessionsBefore.length) {
          throw new Error(`group moves changed b's sessions (${bSessionsBefore.length} -> ${bSessionsAfter.length})`);
        }

        // (10d) Real pointer drag starting on b's group `+` button. A dragstart
        // always targets the draggable row, so the button guard must come from the
        // pointerdown origin; otherwise a slight movement reorders/reparents the
        // group and suppresses the button click. No order/parent/revision change.
        const orderBeforeGuard = await ui.rootGroupIds();
        const parentsBeforeGuard = recordParents();
        const revisionBeforeGuard = recordRevision();
        // Real pointer input is blocked by the late-mounting onboarding overlay;
        // close it first (the earlier group drags are synthetic and bypass it).
        await ui.dismissOverlay();
        await ui.closeOnboarding(2000);
        const guardProbe = await ui.dragGroupFromButton(b, e);
        await sleep(400);
        if (await ui.dialogOpen()) {
          await driver.evaluate(`document.querySelector('.dsg-dialog-cancel')?.click()`);
          await ui.waitFor(`!document.querySelector(${JSON.stringify(DIALOG)})`, 'button-drag dialog dismissed', 5000);
        }
        if (await ui.exists(MENU)) await ui.closeMenu();
        const orderAfterGuard = await ui.rootGroupIds();
        const parentsAfterGuard = recordParents();
        const revisionAfterGuard = recordRevision();
        if (JSON.stringify(orderAfterGuard) !== JSON.stringify(orderBeforeGuard)) {
          throw new Error(`group + pointer drag reordered roots: ${JSON.stringify(orderBeforeGuard)} -> ${JSON.stringify(orderAfterGuard)}`);
        }
        if (JSON.stringify(parentsAfterGuard) !== JSON.stringify(parentsBeforeGuard)) {
          throw new Error(`group + pointer drag changed parents: ${JSON.stringify(parentsBeforeGuard)} -> ${JSON.stringify(parentsAfterGuard)}`);
        }
        if (revisionAfterGuard !== revisionBeforeGuard) {
          throw new Error(`group + pointer drag committed a revision (${revisionBeforeGuard} -> ${revisionAfterGuard})`);
        }
        if (!guardProbe.some((entry) => entry.gid === b)) {
          throw new Error(`real pointer drag from the group + button never fired a row dragstart (probe=${JSON.stringify(guardProbe)})`);
        }
        if (!guardProbe.some((entry) => entry.gid === b && entry.prevented === true)) {
          throw new Error(`group + dragstart was not cancelled by the pointerdown guard (probe=${JSON.stringify(guardProbe)})`);
        }
        // A mouseup over the target row can synthesise a click there; restore any
        // collapsed expansion so step 15 starts from a normal tree.
        await sleep(500);
        for (const gid of [b, e]) {
          const expanded = (await ui.attrs(`${GROUP}[data-group-id="${gid}"]`, 'data-expanded'))[0];
          if (expanded === 'false') {
            await ui.click(`${GROUP}[data-group-id="${gid}"]`);
            await sleep(300);
          }
        }
        // Step 15 continues in the groups view.
        if (!(await ui.exists(VIEW))) throw new Error('step 14 must end in the groups view');

        return {
          initialOrder,
          afterRapid,
          rapidChildren,
          rootOrder: await ui.rootGroupIds(),
          bSessions: bSessionsAfter.length,
          slotAudit,
          menuMoveUp: [b, e, a],
          middleInvalid: true,
          samePositionNoop: true,
          buttonGuard: { probe: guardProbe, revision: revisionAfterGuard },
          revision: {
            beforeNoop: revisionBeforeNoop,
            afterSelf: revisionAfterSelf,
            afterRootEnd: revisionAfterRootEnd,
            beforeMiddle: revisionBeforeMiddle,
            afterMiddle: revisionAfterMiddle,
            beforeSame: revisionBeforeSame,
            afterSame: revisionAfterSame,
            beforeGuard: revisionBeforeGuard,
            afterGuard: revisionAfterGuard,
          },
        };
      },
    },
    {
      id: 15,
      name: 'search-session-reveal',
      async run() {
        // Step 14 leaves the groups view active (asserted there); this step owns
        // the search dropdown: reveal on select, archived rows disabled, empty
        // state and the read-only guarantee for dsh-session-groups.json.
        const { a, child } = state.groups;
        if (!a) throw new Error('step 15 needs group a from step 3');
        if (!child) throw new Error('step 15 needs the nested child group from step 3');
        if (!(await ui.exists(VIEW))) throw new Error('step 15 must start in the groups view');
        if (!(await ui.exists(SEARCH_TOGGLE))) throw new Error(`search toggle ${SEARCH_TOGGLE} is missing (search UI not implemented)`);
        if (await ui.exists(SEARCH)) throw new Error('search field must start collapsed before the search icon is clicked');
        await ui.click(SEARCH_TOGGLE);
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(SEARCH)})`, 'search field expanded from the header icon', 5000);
        if ((await driver.evaluate(`document.activeElement?.getAttribute('data-testid') ?? null`)) !== 'session-groups-search') {
          throw new Error('opening the search field must focus the search input');
        }

        // -- settled record snapshots (search must never write the group doc) --
        const recordPath = join(QA_HOME, 'storages', 'dsh-session-groups.json');
        const readRecord = () => JSON.parse(readFileSync(recordPath, 'utf8'));
        const comparable = (record) => JSON.stringify({ groups: record.groups ?? [], ungrouped: record.ungrouped ?? [] });
        const settledRecord = async () => {
          const first = readRecord();
          await sleep(300);
          const second = readRecord();
          return { first, second };
        };
        const assertSettled = (pair, label) => {
          if (comparable(pair.first) !== comparable(pair.second)) {
            throw new Error(`${label}: group record still changing between two reads 300 ms apart`);
          }
        };

        const isBlankTitle = (title) => !title || /^(新会话|New session|未命名|Untitled)$/.test(title.trim());
        /** First rendered row matching `filter` that has a real (non-blank) title. */
        const pickTitledRow = async (filter) => {
          for (const row of await ui.sessions()) {
            if (!filter(row)) continue;
            const title = await ui.sessionTitle(row.sid);
            if (isBlankTitle(title)) continue;
            return { sid: row.sid, title, groupId: row.groupId };
          }
          return null;
        };

        // (1) Pick a cheap non-blank group-a title BEFORE collapsing the group.
        // The frozen fixture's historical sessions are multi-MB transcripts and
        // the host blocks the renderer while loading one, so first rename the
        // group-a blank placeholder (a few hundred bytes) into a unique non-blank
        // title and search for that. Only `.dsg-session-title` is read (the full
        // row text appends the workspace badge).
        const expandedNow = (await ui.attrs(`${GROUP}[data-group-id="${a}"]`, 'data-expanded'))[0];
        if (expandedNow !== 'true') {
          await ui.click(`${GROUP}[data-group-id="${a}"]`);
          await ui.waitFor(
            `document.querySelector(${JSON.stringify(GROUP)} + '[data-group-id="${a}"]')?.getAttribute('data-expanded') === 'true'`,
            `group ${a} expanded`,
            8000,
          );
        }
        let blankRow = null;
        for (const row of await ui.sessions()) {
          if (row.groupId !== a || row.archived === true) continue;
          if (isBlankTitle(await ui.sessionTitle(row.sid))) {
            blankRow = { sid: row.sid };
            break;
          }
        }
        if (!blankRow) throw new Error('group a has no blank session row to turn into a cheap non-blank search target');
        const searchTitle = `E2E-搜索-${Date.now().toString(36).slice(-4)}`;
        await ui.openSessionMenu(blankRow.sid);
        const renameItems = await ui.menuItems();
        if (!renameItems.some((text) => /重命名|Rename/.test(text))) {
          throw new Error(`session menu has no rename entry for the search target (items: ${JSON.stringify(renameItems.slice(0, 12))})`);
        }
        await ui.clickMenuItem(/重命名|Rename/);
        await ui.fillDialog(searchTitle);
        await ui.confirmDialog();
        await ui.waitFor(
          `Array.from(document.querySelectorAll(${JSON.stringify(SESSION)}), (el) => (el.querySelector('.dsg-session-title')?.textContent ?? '')).some((text) => text.includes(${JSON.stringify(searchTitle)}))`,
          'renamed cheap search target row',
          8000,
        );
        // Read the title back through the helper on the now non-blank row.
        const target = { sid: blankRow.sid, title: await ui.sessionTitle(blankRow.sid) };
        if (target.title !== searchTitle) {
          throw new Error(`renamed search target title expected ${JSON.stringify(searchTitle)}, got ${JSON.stringify(target.title)}`);
        }
        state.searchTitle = target.title;
        state.searchSession = target.sid;

        // (1b) Move the cheap renamed target into the nested child group. The
        // reveal below must then expand both the containing child and its ancestor
        // a (nested-ancestor reveal coverage). This is a host-side group write, so
        // it happens before the read-only record snapshot.
        await sleep(500); // the group-drag click guard swallows clicks for 400 ms after a dragstart
        await ui.dragSessionToGroup(target.sid, child);
        await ui.waitFor(
          `document.querySelector(${JSON.stringify(SESSION)} + '[data-session-id="${target.sid}"]')?.getAttribute('data-group-id') === ${JSON.stringify(child)}`,
          'search target moved into the nested child group',
          8000,
        );

        // The record snapshot is taken after the rename/move (host-side only) and
        // before any search call: everything below must leave it untouched.
        const before = await settledRecord();
        assertSettled(before, 'record before search');

        // (2) Collapse the nested child and its ancestor a, switch the archive
        // filter to "only" (the target row is then hidden), search the title,
        // ArrowDown to it, Enter: the filter must fall back to "all", both groups
        // must expand, and the row must render, highlight and scroll into view.
        await sleep(500); // the group-drag click guard swallows clicks for 400 ms after a dragstart
        await ui.click(`${GROUP}[data-group-id="${child}"]`);
        await ui.waitFor(
          `document.querySelector(${JSON.stringify(GROUP)} + '[data-group-id="${child}"]')?.getAttribute('data-expanded') === 'false'`,
          `nested child group ${child} collapsed`,
          8000,
        );
        await ui.click(`${GROUP}[data-group-id="${a}"]`);
        await ui.waitFor(
          `document.querySelector(${JSON.stringify(GROUP)} + '[data-group-id="${a}"]')?.getAttribute('data-expanded') === 'false'`,
          `group ${a} collapsed`,
          8000,
        );
        if (await ui.exists(`${SESSION}[data-session-id="${target.sid}"]`)) {
          throw new Error(`collapsed group ${a} still renders the target row`);
        }
        await ui.setFilter('only');
        if ((await ui.filterState()) !== 'only') throw new Error('archive filter must be "only" before the search selection');
        const scrollBefore = await ui.setTreeScrollTop(0);
        if (!Number.isFinite(scrollBefore)) throw new Error(`tree scroll container ${TREE} missing`);

        if ((await ui.searchExpanded()) !== 'false') throw new Error('search input must start with aria-expanded="false"');
        await ui.fillSearch(state.searchTitle);
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(SEARCH_RESULTS)})`, 'search dropdown open');
        await ui.waitFor(`document.querySelectorAll(${JSON.stringify(SEARCH_RESULT)}).length > 0`, 'search results rendered');
        if ((await ui.searchExpanded()) !== 'true') throw new Error('search input must report aria-expanded="true" while open');
        const listboxRole = (await ui.attrs(SEARCH_RESULTS, 'role'))[0];
        if (listboxRole !== 'listbox') throw new Error(`search dropdown role expected "listbox", got ${JSON.stringify(listboxRole)}`);
        const results = await ui.searchResults();
        const targetIndex = results.findIndex((entry) => entry.sid === target.sid);
        if (targetIndex === -1) {
          throw new Error(`search results for ${JSON.stringify(state.searchTitle)} do not include ${target.sid} (got ${JSON.stringify(results.map((entry) => entry.sid))})`);
        }
        for (let step = 0; step <= targetIndex; step += 1) await ui.pressSearchKey('ArrowDown');
        const activeSid = await driver.evaluate(`document.querySelector(${JSON.stringify(SEARCH_RESULT)} + '[data-active="true"]')?.getAttribute('data-session-id') ?? null`);
        if (activeSid !== target.sid) throw new Error(`ArrowDown active result expected ${target.sid}, got ${activeSid}`);
        await ui.pressSearchKey('Enter');

        // only -> all visibility correction (spec §3.3 step 2).
        await ui.waitFor(
          `document.querySelector(${JSON.stringify(FILTER_STATE)})?.getAttribute('data-filter') === 'all'`,
          'archive filter switched only -> all for the hidden search result',
          5000,
        );
        const filterAfterSelect = await ui.filterState();
        if (filterAfterSelect !== 'all') throw new Error(`only -> all filter correction failed (got ${filterAfterSelect})`);
        await ui.waitFor(
          `(() => {
            const row = document.querySelector(${JSON.stringify(SESSION)} + '[data-session-id="${target.sid}"]');
            return !!row && row.classList.contains('dsg-search-hit');
          })()`,
          'revealed row rendered with the dsg-search-hit highlight',
          5000,
        );
        const ancestorExpanded = (await ui.attrs(`${GROUP}[data-group-id="${a}"]`, 'data-expanded'))[0];
        if (ancestorExpanded !== 'true') {
          throw new Error(`ancestor group ${a} must expand after the nested search selection (data-expanded=${ancestorExpanded})`);
        }
        const childExpanded = (await ui.attrs(`${GROUP}[data-group-id="${child}"]`, 'data-expanded'))[0];
        if (childExpanded !== 'true') {
          throw new Error(`containing child group ${child} must expand after the nested search selection (data-expanded=${childExpanded})`);
        }
        await ui.waitFor(`document.querySelector(${JSON.stringify(TREE)})?.scrollTop !== ${scrollBefore}`, 'tree scrolled to the revealed row', 5000);
        const scrollAfter = await ui.treeScrollTop();
        if (!(Number.isFinite(scrollAfter) && Math.abs(scrollAfter - scrollBefore) > 1)) {
          throw new Error(`tree scrollTop did not change after reveal (before=${scrollBefore}, after=${scrollAfter})`);
        }
        if (await ui.exists(SEARCH_RESULTS)) throw new Error('search dropdown must close after a selection');
        if ((await driver.evaluate(`document.querySelector(${JSON.stringify(SEARCH)})?.value ?? null`)) !== '') {
          throw new Error('search input must clear after a selection');
        }
        // Restore the default filter for the archive-side checks below.
        await ui.setFilter('hidden');
        if ((await ui.filterState()) !== 'hidden') throw new Error('archive filter must return to "hidden" after the only -> all check');

        // (3) Archive another visible non-blank session through its ... menu, then
        // search its old title: the result is listed but disabled and Enter must
        // leave the main session untouched.
        const currentBefore = await ui.currentSessionId();
        const victim = await pickTitledRow(
          (row) => row.archived !== true && row.sid !== target.sid && row.sid !== currentBefore && row.sid !== state.createdSession,
        );
        if (!victim) throw new Error('no other visible non-blank session available to archive');
        state.archivedTitle = victim.title;
        state.archivedSession = victim.sid;
        await ui.openSessionMenu(victim.sid);
        const menu = await ui.menuItems();
        if (!menu.some((text) => /^(归档|Archive)$/.test(text.trim()))) {
          throw new Error(`session menu has no archive entry for ${victim.sid} (items: ${JSON.stringify(menu.slice(0, 12))})`);
        }
        await ui.clickMenuItem(/^(归档|Archive)$/);
        await sleep(500);
        if (await ui.dialogOpen()) {
          // Running session: the client confirms before stopping activity.
          await ui.click(DIALOG_CONFIRM);
          await sleep(500);
        }
        await ui.waitFor(
          `!Array.from(document.querySelectorAll(${JSON.stringify(SESSION)})).some((el) => el.getAttribute('data-session-id') === ${JSON.stringify(victim.sid)})`,
          `archived session ${victim.sid} hidden under the hidden filter`,
          10000,
        );

        await ui.fillSearch(state.archivedTitle);
        await ui.waitFor(`document.querySelectorAll(${JSON.stringify(SEARCH_RESULT)}).length > 0`, 'archived search results');
        const archivedResults = await ui.searchResults();
        const archivedIndex = archivedResults.findIndex((entry) => entry.sid === victim.sid);
        if (archivedIndex === -1) {
          throw new Error(`archived session ${victim.sid} is missing from search results (got ${JSON.stringify(archivedResults.map((entry) => entry.sid))})`);
        }
        const archivedEntry = archivedResults[archivedIndex];
        if (archivedEntry.archived !== 'true') throw new Error(`archived result data-archived expected "true", got ${JSON.stringify(archivedEntry.archived)}`);
        if (archivedEntry.ariaDisabled !== 'true') throw new Error(`archived result aria-disabled expected "true", got ${JSON.stringify(archivedEntry.ariaDisabled)}`);
        for (let step = 0; step <= archivedIndex; step += 1) await ui.pressSearchKey('ArrowDown');
        const archivedActive = await driver.evaluate(`document.querySelector(${JSON.stringify(SEARCH_RESULT)} + '[data-active="true"]')?.getAttribute('data-session-id') ?? null`);
        if (archivedActive !== victim.sid) throw new Error(`ArrowDown active archived result expected ${victim.sid}, got ${archivedActive}`);
        await ui.pressSearchKey('Enter');
        await sleep(400);
        await ui.waitFor(`/已归档|Archived/.test(document.querySelector(${JSON.stringify(TOAST)})?.textContent ?? '')`, 'archived-disabled toast', 3000);
        const currentAfter = await ui.currentSessionId();
        if (currentAfter !== currentBefore) {
          throw new Error(`Enter on an archived result changed the main session (${JSON.stringify(currentBefore)} -> ${JSON.stringify(currentAfter)})`);
        }

        // (4) Nonsense query renders the empty state; Escape closes the dropdown.
        await ui.fillSearch(`zzz-no-such-session-${Date.now().toString(36)}`);
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(SEARCH_EMPTY)})`, 'search empty state', 5000);
        if ((await ui.count(SEARCH_RESULT)) !== 0) throw new Error('empty search state kept result rows');
        await ui.pressSearchKey('Escape');
        await ui.waitFor(`!document.querySelector(${JSON.stringify(SEARCH_RESULTS)})`, 'search dropdown closed on Escape', 3000);

        // (5) Click-outside also closes the dropdown.
        await ui.fillSearch(state.searchTitle);
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(SEARCH_RESULTS)})`, 'search dropdown re-opened');
        await ui.clickOutsideSearch();
        await ui.waitFor(`!document.querySelector(${JSON.stringify(SEARCH_RESULTS)})`, 'search dropdown closed on an outside pointerdown', 3000);
        await ui.fillSearch('');

        // (5b) Keyboard-active result inside the 320px scrolling listbox: a broad
        // workspace query yields a full page of rows; repeated ArrowDown must keep
        // the active option inside the listbox rect (and the listbox scrolled).
        await ui.fillSearch('Projects');
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(SEARCH_RESULTS)})`, 'broad search dropdown open');
        await ui.waitFor(`document.querySelectorAll(${JSON.stringify(SEARCH_RESULT)}).length > 0`, 'broad search results rendered');
        const broadCount = await ui.count(SEARCH_RESULT);
        if (broadCount < 12) throw new Error(`broad query 'Projects' yielded only ${broadCount} results; need >=12 for the keyboard-scroll check`);
        const keyboardTarget = Math.min(15, broadCount - 1);
        for (let step = 0; step <= keyboardTarget; step += 1) await ui.pressSearchKey('ArrowDown');
        const activeInfo = await ui.searchActiveInfo();
        if (!activeInfo) throw new Error('no keyboard-active search option after repeated ArrowDown');
        if (!activeInfo.inside) {
          throw new Error(`keyboard-active search option is clipped by the listbox: ${JSON.stringify(activeInfo)}`);
        }
        if (!(activeInfo.scrollTop > 0)) {
          throw new Error(`keyboard navigation did not scroll the search listbox (scrollTop=${activeInfo.scrollTop})`);
        }
        await ui.fillSearch('');
        await ui.waitFor(`!document.querySelector(${JSON.stringify(SEARCH_RESULTS)})`, 'broad search dropdown closed after clearing');

        // (5c) The search field is a toggled row, not always-visible chrome:
        // Escape with no dropdown collapses it, and the header close button does
        // too (feedback item 3: search icon toggles, Escape/clear closes).
        await ui.pressSearchKey('Escape');
        await ui.waitFor(`!document.querySelector(${JSON.stringify(SEARCH)})`, 'search row collapsed on Escape with no dropdown', 3000);
        await ui.click(SEARCH_TOGGLE);
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(SEARCH)})`, 'search row reopened by the search icon');
        await ui.fillSearch(state.searchTitle);
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(SEARCH_RESULTS)})`, 'search dropdown reopened before the close-button check');
        await ui.click(SEARCH_CLOSE);
        await ui.waitFor(`!document.querySelector(${JSON.stringify(SEARCH)})`, 'search row collapsed by the header close button', 3000);
        if (await ui.exists(SEARCH_RESULTS)) throw new Error('search dropdown survived the close button');

        // (6) The whole search flow left groups + ungrouped byte-identical.
        const after = await settledRecord();
        assertSettled(after, 'record after search');
        if (comparable(before.first) !== comparable(after.first)) {
          throw new Error(
            `search changed groups/ungrouped in dsh-session-groups.json: before=${comparable(before.first).slice(0, 240)} after=${comparable(after.first).slice(0, 240)}`,
          );
        }

        return {
          searchSession: target.sid,
          searchTitle: state.searchTitle,
          nestedReveal: { ancestor: a, child, ancestorExpanded, childExpanded },
          onlyToAll: { before: 'only', after: filterAfterSelect },
          keyboardScroll: { targetIndex: keyboardTarget, info: activeInfo },
          scroll: { before: scrollBefore, after: scrollAfter },
          archivedSession: victim.sid,
          archivedTitle: state.archivedTitle,
          archivedEnterBlocked: true,
          emptyState: true,
          clickOutside: true,
          searchToggle: { escapeCollapsedRow: true, closeButtonCollapsedRow: true },
          record: { unchanged: true, revision: before.first.revision, groups: (before.first.groups ?? []).length },
          sideEffect: `session ${victim.sid} left archived by step 15 (host-side archive; the group record file is unchanged)`,
        };
      },
    },
    {
      id: 16,
      name: 'typography-matches-official-sidebar',
      async run() {
        // Step 15 leaves the groups view active. This step measures the official
        // DSH 2.0.18 typography *and* spacing chrome (computed styles + rects):
        // rows keep their 34/32 heights but now carry the official 8px row
        // padding / 6px gap, the tree breathes at a 2px vertical gap, the section
        // header keeps the 36px-equivalent rhythm around 28px controls, search
        // results/menus/dialogs use the larger padding, and 264px stays
        // overflow-free. Font sizes/row heights/icon sizes stay unchanged.
        if (!(await ui.exists(VIEW))) throw new Error('step 16 must start in the groups view');
        // Step 15 leaves the search field expanded; collapse it first so the
        // collapsed header metrics (36px) and 264px probe are measured without
        // the optional search row.
        await ui.closeSearch();
        await sleep(200); // let the last step's layout settle before measuring
        const metrics = await driver.evaluate(`(() => {
          const px = (value) => {
            const n = Number.parseFloat(value);
            return Number.isFinite(n) ? n : null;
          };
          const root = document.querySelector('[data-testid="session-groups-view"]');
          if (!root) return { error: 'groups view missing' };

          // Nearest host ancestor of the groups root (the sidebar wrapper that
          // supplies the inherited base font). Falls back to the 14px contract
          // when the root is mounted directly under <body>.
          let host = root.parentElement;
          while (host && host !== document.body && host.nodeType === 1) {
            if (getComputedStyle(host).fontSize) break;
            host = host.parentElement;
          }
          const hostStyle = host && host !== document.body ? getComputedStyle(host) : null;

          const styleOf = (el) => (el ? getComputedStyle(el) : null);
          const rectOf = (el) => (el ? el.getBoundingClientRect() : null);
          const sizeOf = (el) => ({ width: px(styleOf(el)?.width), height: px(styleOf(el)?.height) });
          const fontOf = (el) => ({
            fontSize: px(styleOf(el)?.fontSize),
            lineHeight: px(styleOf(el)?.lineHeight),
            fontWeight: styleOf(el)?.fontWeight ?? null,
          });
          // Computed spacing for one element. rowGap/columnGap stay null when
          // the computed value is 'normal' (no gap), which the assertions treat
          // as a failure only where a gap is required.
          const spaceOf = (el) => {
            const style = styleOf(el);
            return style
              ? {
                  paddingTop: px(style.paddingTop),
                  paddingRight: px(style.paddingRight),
                  paddingBottom: px(style.paddingBottom),
                  paddingLeft: px(style.paddingLeft),
                  rowGap: px(style.rowGap),
                  columnGap: px(style.columnGap),
                  marginLeft: px(style.marginLeft),
                  marginRight: px(style.marginRight),
                }
              : null;
          };

          const groupRow = document.querySelector('.dsg-group-row');
          const sessionRow = document.querySelector('.dsg-session-row');
          const groupName = document.querySelector('.dsg-group-name');
          const sessionTitle = document.querySelector('.dsg-session-title');
          const workspaceBadge = document.querySelector('.dsg-workspace-badge');
          const searchInput = document.querySelector('.dsg-search-input');
          const groupIcon = document.querySelector('.dsg-group-icon svg');
          const groupCaret = document.querySelector('.dsg-group-caret svg');
          const groupActionGlyph = document.querySelector('.dsg-group-actions .dsg-glyph');
          const headerTitle = document.querySelector('.dsg-header-title');
          const headerTitleLabel = document.querySelector('.dsg-header-label');
          const headerAccent = document.querySelector('.dsg-header-accent svg');
          const header = document.querySelector('.dsg-header');
          const headerRow = document.querySelector('.dsg-header-row');
          const searchRow = document.querySelector('.dsg-header-search-row');
          const headerButtons = Array.from(document.querySelectorAll('[data-testid="session-groups-header"] button'), (button) => {
            const rect = button.getBoundingClientRect();
            const svg = button.querySelector('svg');
            const svgRect = svg ? svg.getBoundingClientRect() : null;
            return {
              id: button.getAttribute('data-testid'),
              width: rect.width,
              height: rect.height,
              glyph: svgRect ? { width: svgRect.width, height: svgRect.height } : null,
            };
          });
          const footerToggle = document.querySelector(${JSON.stringify(TOGGLE)});
          const footer = footerToggle ? (() => {
            const style = getComputedStyle(footerToggle);
            const rect = footerToggle.getBoundingClientRect();
            const svg = footerToggle.querySelector('svg');
            const svgRect = svg ? svg.getBoundingClientRect() : null;
            return {
              tag: footerToggle.tagName,
              text: (footerToggle.textContent ?? '').trim(),
              title: footerToggle.getAttribute('title'),
              pressed: footerToggle.getAttribute('aria-pressed'),
              mode: footerToggle.getAttribute('data-mode'),
              wide: footerToggle.getAttribute('data-wide'),
              width: rect.width,
              height: rect.height,
              fontSize: px(style.fontSize),
              lineHeight: px(style.lineHeight),
              color: style.color,
              icon: svgRect ? { width: svgRect.width, height: svgRect.height } : null,
            };
          })() : null;
          const virtualLine = document.querySelector('.dsg-virtual-list');
          // Resolve official theme tokens through a throw-away probe so the
          // assertions compare the real host values instead of hard-coded hex.
          const tokenColor = (name) => {
            const probe = document.createElement('span');
            probe.style.color = 'var(' + name + ')';
            document.body.appendChild(probe);
            const value = getComputedStyle(probe).color;
            probe.remove();
            return value;
          };
          const tree = document.querySelector('.dsg-tree');
          const groupBody = document.querySelector('.dsg-group-body');
          const groupLine = document.querySelector('.dsg-group-line');
          const ungroupedHeader = document.querySelector('.dsg-ungrouped-header');
          const rootStyle = getComputedStyle(root);

          return {
            root: {
              fontSize: px(rootStyle.fontSize),
              fontFamily: rootStyle.fontFamily,
              lineHeight: rootStyle.lineHeight,
              font14Token: rootStyle.getPropertyValue('--dsg-font-14').trim(),
            },
            host: {
              found: !!hostStyle,
              tag: host ? host.tagName.toLowerCase() : null,
              fontSize: hostStyle ? px(hostStyle.fontSize) : null,
              fontFamily: hostStyle ? hostStyle.fontFamily : null,
            },
            rows: {
              groupRowHeight: rectOf(groupRow)?.height ?? null,
              sessionRowHeight: rectOf(sessionRow)?.height ?? null,
              groupRows: document.querySelectorAll('.dsg-group-row').length,
              sessionRows: document.querySelectorAll('.dsg-session-row').length,
            },
            text: {
              groupName: fontOf(groupName),
              sessionTitle: fontOf(sessionTitle),
              workspaceBadge: fontOf(workspaceBadge),
              headerTitle: { ...fontOf(headerTitle), color: styleOf(headerTitle)?.color },
              headerTitleLabel: fontOf(headerTitleLabel),
              headerAccentColor: styleOf(headerAccent)?.color,
            },
            buttons: {
              header: headerButtons,
            },
            footer,
            virtual: {
              total: Number(virtualLine?.getAttribute('data-virtual-total') ?? NaN),
              start: Number(virtualLine?.getAttribute('data-virtual-start') ?? NaN),
              end: Number(virtualLine?.getAttribute('data-virtual-end') ?? NaN),
              renderedUngrouped: document.querySelectorAll('[data-testid="session-groups-session"][data-ungrouped="true"]').length,
              spacers: document.querySelectorAll('[data-testid="session-groups-virtual-spacer"]').length,
              logicalCount: Number(document.querySelector('[data-testid="session-groups-ungrouped"]')?.getAttribute('data-count') ?? NaN),
            },
            tokens: {
              primary: tokenColor('--dsw-alias-label-primary'),
              accent: tokenColor('--dsw-alias-state-business-primary'),
            },
            spacing: {
              header: {
                ...spaceOf(header),
                height: rectOf(header)?.height ?? null,
                titleRowHeight: rectOf(headerRow)?.height ?? null,
                searchRowHeight: rectOf(searchRow)?.height ?? null,
              },
              groupRow: spaceOf(groupRow),
              sessionRow: spaceOf(sessionRow),
              tree: spaceOf(tree),
              groupBody: spaceOf(groupBody),
              groupLine: spaceOf(groupLine),
              ungroupedHeader: spaceOf(ungroupedHeader),
            },
            icons: {
              groupIcon: sizeOf(groupIcon),
              groupCaret: sizeOf(groupCaret),
              groupActionGlyph: sizeOf(groupActionGlyph),
              headerAccent: sizeOf(headerAccent),
              groupActionButton: {
                width: rectOf(groupActionGlyph?.parentElement)?.width ?? null,
                height: rectOf(groupActionGlyph?.parentElement)?.height ?? null,
              },
              glyphSizes: Array.from(document.querySelectorAll('.dsg-root .dsg-glyph, .dsg-root .dsg-icon')).map((svg) => ({
                width: px(getComputedStyle(svg).width),
                height: px(getComputedStyle(svg).height),
              })),
            },
          };
        })()`);
        if (metrics.error) throw new Error(metrics.error);

        const near = (actual, expected, label, tolerance = 0) => {
          if (typeof actual !== 'number' || Math.abs(actual - expected) > tolerance) {
            throw new Error(`${label}: expected ${expected}${tolerance ? ` ±${tolerance}` : ''}, got ${actual}`);
          }
        };
        // Poll the real sidebar width for the 264px overflow probe (the drag is
        // rAF-throttled, so an immediate read can lag one frame).
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

        // (1) `.dsg-root` consumes the host's inherited font-size: it must equal
        // the nearest host sidebar ancestor (or the 14px fallback), with the same
        // inherited font family.
        const expectedRootFont = metrics.host.found ? metrics.host.fontSize : 14;
        near(metrics.root.fontSize, expectedRootFont, `dsg-root font-size (host ${metrics.host.tag ?? 'none'} = ${expectedRootFont})`);
        if (metrics.host.found) {
          if (metrics.root.fontFamily !== metrics.host.fontFamily) {
            throw new Error(`dsg-root font-family must inherit the host (root=${metrics.root.fontFamily}, host=${metrics.host.fontFamily})`);
          }
        }
        // (2) Officially sized rows: project/group 34px, session 32px.
        near(metrics.rows.groupRowHeight, 34, 'dsg-group-row height', 1);
        near(metrics.rows.sessionRowHeight, 32, 'dsg-session-row height', 1);
        if (metrics.rows.groupRows < 1 || metrics.rows.sessionRows < 1) {
          throw new Error(`typography probe needs rendered rows (groups=${metrics.rows.groupRows}, sessions=${metrics.rows.sessionRows})`);
        }
        // (3) Official title/meta sizes.
        near(metrics.text.groupName.fontSize, 14, 'dsg-group-name font-size');
        near(metrics.text.groupName.lineHeight, 20, 'dsg-group-name line-height');
        near(metrics.text.sessionTitle.fontSize, 14, 'dsg-session-title font-size');
        near(metrics.text.sessionTitle.lineHeight, 20, 'dsg-session-title line-height');
        near(metrics.text.workspaceBadge.fontSize, 12, 'dsg-workspace-badge font-size');
        near(metrics.text.headerTitle.fontSize, 14, 'dsg-header-title font-size');
        near(metrics.text.headerTitle.lineHeight, 20, 'dsg-header-title line-height');
        if (metrics.text.headerTitle.fontWeight !== '400') {
          throw new Error(`dsg-header-title must use the official section-label weight 400, got ${metrics.text.headerTitle.fontWeight}`);
        }
        near(metrics.text.headerTitleLabel.fontSize, 14, 'dsg-header-label font-size');
        if (metrics.text.headerTitle.color !== metrics.tokens.primary) {
          throw new Error(`dsg-header-title must use primary text (${metrics.tokens.primary}), got ${metrics.text.headerTitle.color}`);
        }
        if (metrics.text.headerAccentColor !== metrics.tokens.accent) {
          throw new Error(`header accent icon must use the primary accent (${metrics.tokens.accent}), got ${metrics.text.headerAccentColor}`);
        }
        // (3b) Header actions: search, view-options, plus — each 28x28 with a
        // 16px glyph, in the official workspace-section order.
        const expectedHeaderOrder = ['session-groups-search-toggle', 'session-groups-view-options', 'session-groups-new-group'];
        const actualHeaderOrder = metrics.buttons.header.map((button) => button.id);
        if (JSON.stringify(actualHeaderOrder) !== JSON.stringify(expectedHeaderOrder)) {
          throw new Error(`header action order expected ${JSON.stringify(expectedHeaderOrder)}, got ${JSON.stringify(actualHeaderOrder)}`);
        }
        for (const button of metrics.buttons.header) {
          near(button.width, 28, `${button.id} width`, 1);
          near(button.height, 28, `${button.id} height`, 1);
          if (!button.glyph) throw new Error(`${button.id} has no glyph`);
          near(button.glyph.width, 16, `${button.id} glyph width`);
          near(button.glyph.height, 16, `${button.id} glyph height`);
        }
        // (3c) Footer single button: 28px high, 13px text, 16px icon; the active
        // mode is groups and the label/icon target the workspace view.
        if (!metrics.footer) throw new Error('footer toggle is missing');
        if (metrics.footer.tag !== 'BUTTON') throw new Error(`footer toggle must be a button, got ${metrics.footer.tag}`);
        if (metrics.footer.mode !== 'groups' || metrics.footer.pressed !== 'true') {
          throw new Error(`footer expected groups/pressed, got ${metrics.footer.mode}/${metrics.footer.pressed}`);
        }
        if (metrics.footer.wide !== 'true') throw new Error(`wide footer expected data-wide="true", got ${metrics.footer.wide}`);
        near(metrics.footer.height, 28, 'footer height', 1);
        near(metrics.footer.fontSize, 13, 'footer font-size');
        near(metrics.footer.icon.width, 16, 'footer icon width');
        near(metrics.footer.icon.height, 16, 'footer icon height');
        if (!/^(返回默认工作区视图|Back to default workspace view)$/.test(metrics.footer.text)) {
          throw new Error(`footer label must be exactly 返回默认工作区视图 / Back to default workspace view while groups are active, got ${JSON.stringify(metrics.footer.text)}`);
        }
        if (!/^(返回默认工作区视图|Back to default workspace view)$/.test(metrics.footer.title ?? '')) {
          throw new Error(`footer title must match the label, got ${JSON.stringify(metrics.footer.title)}`);
        }
        // (3d) Virtualized ungrouped list: the rendered rows stay within the
        // logical count and the window bookkeeping is coherent. The normal QA
        // fixture is small enough that every row fits; the large-list probe
        // asserts the bounded-DOM case with ~1,500 rows.
        const virtual = metrics.virtual;
        if (!Number.isFinite(virtual.total) || virtual.total !== virtual.logicalCount) {
          throw new Error(`virtual ungrouped total ${virtual.total} must equal the header logical count ${virtual.logicalCount}`);
        }
        if (!(virtual.renderedUngrouped <= virtual.total)) {
          throw new Error(`virtual ungrouped rendered ${virtual.renderedUngrouped} must not exceed the logical total ${virtual.total}`);
        }
        if (virtual.end - virtual.start !== virtual.renderedUngrouped) {
          throw new Error(`virtual window bookkeeping mismatch: end-start=${virtual.end - virtual.start}, rendered=${virtual.renderedUngrouped}`);
        }
        if (virtual.renderedUngrouped > 80) {
          throw new Error(`virtual ungrouped list rendered ${virtual.renderedUngrouped} rows (>80); windowing is not active`);
        }
        // (4) Official 16px glyphs (group icon, caret, group action glyph, and
        // every icon rendered inside the groups root).
        for (const [label, size] of [
          ['dsg-group-icon svg', metrics.icons.groupIcon],
          ['dsg-group-caret svg', metrics.icons.groupCaret],
          ['group action glyph', metrics.icons.groupActionGlyph],
          ['header accent glyph', metrics.icons.headerAccent],
        ]) {
          near(size.width, 16, `${label} width`);
          near(size.height, 16, `${label} height`);
        }
        near(metrics.icons.groupActionButton.width, 16, 'group action button width');
        near(metrics.icons.groupActionButton.height, 16, 'group action button height');
        for (const [index, size] of metrics.icons.glyphSizes.entries()) {
          near(size.width, 16, `glyph[${index}] width`);
          near(size.height, 16, `glyph[${index}] height`);
        }
        if (metrics.root.font14Token !== '14px') {
          throw new Error(`official font token --dsg-font-14 should resolve to 14px, got ${JSON.stringify(metrics.root.font14Token)}`);
        }
        // (5) Official spacing chrome (DSH 2.0.18): rows keep their 34/32 heights
        // but use the official `padding: 0 8px` + 6px row gap; the list/tree uses
        // a 2px vertical gap; group guides indent 10/10; the section header keeps
        // the 36px-equivalent rhythm (28px control row + 4px/8px vertical padding)
        // and an 8px row gap; search results/menus use the roomier padding.
        const space = metrics.spacing;
        for (const [label, box] of [
          ['dsg-group-row', space.groupRow],
          ['dsg-session-row', space.sessionRow],
        ]) {
          if (!box) throw new Error(`${label} spacing probe is missing`);
          near(box.paddingLeft, 8, `${label} padding-left`, 1);
          near(box.paddingRight, 8, `${label} padding-right`, 1);
          near(box.paddingTop, 0, `${label} padding-top`, 1);
          near(box.paddingBottom, 0, `${label} padding-bottom`, 1);
          near(box.columnGap, 6, `${label} column-gap`, 1);
        }
        if (!space.tree) throw new Error('dsg-tree spacing probe is missing');
        near(space.tree.rowGap, 2, 'dsg-tree row-gap', 1);
        if (!space.groupBody) throw new Error('dsg-group-body spacing probe is missing');
        near(space.groupBody.rowGap, 2, 'dsg-group-body row-gap', 1);
        if (!space.groupLine) throw new Error('dsg-group-line spacing probe is missing');
        near(space.groupLine.rowGap, 2, 'dsg-group-line row-gap', 1);
        near(space.groupLine.marginLeft, 10, 'dsg-group-line margin-left', 1);
        near(space.groupLine.paddingLeft, 10, 'dsg-group-line padding-left', 1);
        if (space.ungroupedHeader) {
          near(space.ungroupedHeader.columnGap, 6, 'dsg-ungrouped-header column-gap', 1);
        }
        if (!space.header) throw new Error('dsg-header spacing probe is missing');
        near(space.header.paddingTop, 4, 'dsg-header padding-top', 1);
        near(space.header.paddingRight, 4, 'dsg-header padding-right', 1);
        near(space.header.paddingBottom, 4, 'dsg-header padding-bottom', 1);
        near(space.header.paddingLeft, 2, 'dsg-header padding-left', 1);
        near(space.header.rowGap, 8, 'dsg-header row-gap', 1);
        near(space.header.titleRowHeight, 28, 'header title row height', 1);
        near(space.header.height, 36, 'collapsed header height (4+28+4)', 1);
        // Official sectionHeader is 36px tall; the controls row plus 4px/4px
        // vertical padding keeps the same 36px rhythm.
        near(space.header.paddingTop + space.header.titleRowHeight + space.header.paddingBottom, 36, 'header section rhythm', 1);

        // (6) Search results (dropdown opened only for measurement, then cleared):
        // result padding >= 6px/10px, 8px title/meta gap, 2px list row gap.
        await ui.fillSearch(state.searchTitle);
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(SEARCH_RESULTS)})`, 'step 16 search dropdown open');
        await ui.waitFor(`document.querySelectorAll(${JSON.stringify(SEARCH_RESULT)}).length > 0`, 'step 16 search results rendered');
        await sleep(120);
        const searchSpacing = await driver.evaluate(`(() => {
          const px = (value) => {
            const n = Number.parseFloat(value);
            return Number.isFinite(n) ? n : null;
          };
          const list = document.querySelector(${JSON.stringify(SEARCH_RESULTS)});
          const result = document.querySelector(${JSON.stringify(SEARCH_RESULT)});
          const input = document.querySelector(${JSON.stringify(SEARCH)});
          const header = document.querySelector(${JSON.stringify(HEADER)});
          const searchRow = document.querySelector('.dsg-header-search-row');
          if (!list || !result || !input || !header) return { error: 'search results/input missing' };
          const listStyle = getComputedStyle(list);
          const resultStyle = getComputedStyle(result);
          const inputStyle = getComputedStyle(input);
          return {
            list: {
              paddingTop: px(listStyle.paddingTop),
              paddingLeft: px(listStyle.paddingLeft),
              rowGap: px(listStyle.rowGap),
              background: listStyle.backgroundColor,
              color: listStyle.color,
            },
            result: {
              paddingTop: px(resultStyle.paddingTop),
              paddingRight: px(resultStyle.paddingRight),
              paddingBottom: px(resultStyle.paddingBottom),
              paddingLeft: px(resultStyle.paddingLeft),
              columnGap: px(resultStyle.columnGap),
              color: resultStyle.color,
            },
            input: {
              fontSize: px(inputStyle.fontSize),
              height: input.getBoundingClientRect().height,
              background: inputStyle.backgroundColor,
              color: inputStyle.color,
            },
            header: {
              height: header.getBoundingClientRect().height,
              searchOpen: header.getAttribute('data-search-open'),
              searchRowHeight: searchRow ? searchRow.getBoundingClientRect().height : null,
              searchToggleExpanded: document.querySelector(${JSON.stringify(SEARCH_TOGGLE)})?.getAttribute('aria-expanded') ?? null,
            },
          };
        })()`);
        if (searchSpacing.error) throw new Error(searchSpacing.error);
        near(searchSpacing.input.fontSize, 13, 'dsg-search-input font-size');
        near(searchSpacing.input.height, 30, 'dsg-search-input height', 1);
        near(searchSpacing.header.height, 74, 'expanded header height (36 + 8 + 30)', 1);
        near(searchSpacing.header.searchRowHeight, 30, 'header search row height', 1);
        if (searchSpacing.header.searchOpen !== 'true') throw new Error('header data-search-open must be true while the field is visible');
        if (searchSpacing.header.searchToggleExpanded !== 'true') throw new Error('search toggle must report aria-expanded=true while open');
        near(searchSpacing.list.paddingTop, 6, 'search results padding-top', 1);
        near(searchSpacing.list.paddingLeft, 10, 'search results padding-left', 1);
        near(searchSpacing.list.rowGap, 2, 'search results row-gap', 1);
        for (const [side, value, expected] of [
          ['top', searchSpacing.result.paddingTop, 6],
          ['right', searchSpacing.result.paddingRight, 10],
          ['bottom', searchSpacing.result.paddingBottom, 6],
          ['left', searchSpacing.result.paddingLeft, 10],
        ]) {
          if (typeof value !== 'number' || value < expected - 1) {
            throw new Error(`search result padding-${side}: expected at least ${expected}px (±1), got ${value}`);
          }
        }
        near(searchSpacing.result.columnGap, 8, 'search result column-gap', 1);
        await ui.fillSearch('');
        await sleep(120);
        await ui.closeSearch();

        // (7) 264px minimum width: header and tree must not overflow horizontally.
        const widthBefore = await ui.sidebarWidth();
        if (!(widthBefore > 0)) throw new Error(`could not measure the sidebar width before the 264px probe (got ${widthBefore})`);
        await ui.dragResizeHandle(264);
        const minimumWidth = await waitWidth(264, 'sidebar width for the 264px overflow probe');
        await sleep(150);
        const narrowProbe = await driver.evaluate(`(() => {
          const box = (el) => (el ? { clientWidth: el.clientWidth, scrollWidth: el.scrollWidth } : null);
          return {
            header: box(document.querySelector(${JSON.stringify(HEADER)})),
            tree: box(document.querySelector('.dsg-tree')),
          };
        })()`);
        if (!narrowProbe.header || !narrowProbe.tree) throw new Error('264px probe could not measure the groups header/tree');
        if (narrowProbe.header.scrollWidth > narrowProbe.header.clientWidth + 1) {
          throw new Error(`groups header overflows at 264px: scrollWidth ${narrowProbe.header.scrollWidth} > clientWidth ${narrowProbe.header.clientWidth}`);
        }
        if (narrowProbe.tree.scrollWidth > narrowProbe.tree.clientWidth + 1) {
          throw new Error(`groups tree overflows at 264px: scrollWidth ${narrowProbe.tree.scrollWidth} > clientWidth ${narrowProbe.tree.clientWidth}`);
        }
        // Expanded search at 264px: the 30px search row must also stay inside.
        await ui.click(SEARCH_TOGGLE);
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(SEARCH)})`, 'search row expanded at 264px', 5000);
        await sleep(150);
        const narrowSearch = await driver.evaluate(`(() => {
          const box = (el) => (el ? { clientWidth: el.clientWidth, scrollWidth: el.scrollWidth } : null);
          return {
            header: box(document.querySelector(${JSON.stringify(HEADER)})),
            searchRow: box(document.querySelector('.dsg-header-search-row')),
            input: box(document.querySelector(${JSON.stringify(SEARCH)})),
          };
        })()`);
        if (!narrowSearch.header || !narrowSearch.searchRow || !narrowSearch.input) {
          throw new Error(`264px expanded-search probe missing nodes: ${JSON.stringify(narrowSearch)}`);
        }
        for (const [label, box] of [['header', narrowSearch.header], ['search row', narrowSearch.searchRow], ['search input', narrowSearch.input]]) {
          if (box.scrollWidth > box.clientWidth + 1) {
            throw new Error(`groups ${label} overflows at 264px with search open: ${box.scrollWidth} > ${box.clientWidth}`);
          }
        }
        await ui.closeSearch();
        await ui.dragResizeHandle(widthBefore);
        const widthRestored = await waitWidth(widthBefore, 'sidebar width restored after the 264px probe');

        return {
          official: {
            hostBase: metrics.host.fontSize,
            hostAncestor: metrics.host.tag,
            rows: { group: 34, session: 32 },
            titles: { fontSize: 14, lineHeight: 20 },
            meta: { workspaceBadge: 12, searchInput: 13 },
            icons: 16,
            header: { height: 36, expandedHeight: 74, actions: expectedHeaderOrder },
            footer: { height: 28, mode: metrics.footer.mode, text: metrics.footer.text, pressed: metrics.footer.pressed },
            virtual: metrics.virtual,
            spacing: {
              rowPadding: '0 8px',
              rowGap: 6,
              treeRowGap: 2,
              headerPadding: '4px 4px 4px 2px',
              headerRowGap: 8,
              groupGuide: { marginLeft: 10, paddingLeft: 10 },
            },
          },
          spacing: {
            header: space.header,
            rows: { group: space.groupRow, session: space.sessionRow },
            tree: space.tree,
            groupBody: space.groupBody,
            groupLine: space.groupLine,
            ungroupedHeader: space.ungroupedHeader,
            search: searchSpacing,
            minWidth: { width: minimumWidth, restored: widthRestored, ...narrowProbe },
          },
          measured: metrics,
        };
      },
    },
    {
      id: 17,
      name: 'dark-theme-surfaces',
      async run() {
        // Step 16 restores the groups view and the persisted width. This step
        // forces the official dark theme attribute on <body> and asserts the
        // computed surfaces/text of the search dropdown, menu, dialog and dialog
        // input are theme-aware (no white cards) with readable contrast.
        if (!(await ui.exists(VIEW))) throw new Error('step 17 must start in the groups view');
        await ui.closeViewOptions();
        if (await ui.dialogOpen()) {
          await driver.evaluate(`document.querySelector('.dsg-dialog-cancel')?.click()`);
          await ui.waitFor(`!document.querySelector(${JSON.stringify(DIALOG)})`, 'leftover dialog closed', 5000);
        }
        if (await ui.exists(MENU)) {
          await driver.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
          await ui.waitFor(`!document.querySelector(${JSON.stringify(MENU)})`, 'leftover menu closed', 5000);
        }
        await ui.closeSearch();

        const hadDark = Boolean(await driver.evaluate(`document.body.hasAttribute('data-ds-dark-theme')`));
        await driver.evaluate(`document.body.setAttribute('data-ds-dark-theme', '')`);
        await sleep(200);

        const readSurfaces = async () => driver.evaluate(`(() => {
          const parse = (value) => {
            const match = String(value).match(/rgba?\\(([^)]+)\\)/);
            if (!match) return null;
            const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
            if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
            return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
          };
          const channel = (value) => {
            const c = value / 255;
            return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
          };
          const luminance = (color) => 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
          const ratio = (a, b) => {
            const l1 = luminance(a);
            const l2 = luminance(b);
            return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          };
          // Composite a translucent token over the page base so the reported
          // background is the pixel color the user actually sees.
          const base = parse(getComputedStyle(document.body).backgroundColor) ?? { r: 21, g: 21, b: 23, a: 1 };
          const solid = (color) => {
            if (!color) return null;
            if (color.a >= 0.999) return color;
            return {
              r: color.r * color.a + base.r * (1 - color.a),
              g: color.g * color.a + base.g * (1 - color.a),
              b: color.b * color.a + base.b * (1 - color.a),
              a: 1,
            };
          };
          const sample = (selector, textSelector, backgroundSelector) => {
            const el = document.querySelector(selector);
            if (!el) return { missing: selector };
            const bgEl = backgroundSelector ? document.querySelector(backgroundSelector) : el;
            if (!bgEl) return { missing: backgroundSelector };
            const background = solid(parse(getComputedStyle(bgEl).backgroundColor));
            const textEl = textSelector ? document.querySelector(textSelector) : el;
            if (!textEl) return { missing: textSelector };
            const text = parse(getComputedStyle(textEl).color);
            if (!background || !text) return { missing: 'unparsable-color:' + selector };
            return {
              background: [Math.round(background.r), Math.round(background.g), Math.round(background.b)],
              text: [Math.round(text.r), Math.round(text.g), Math.round(text.b)],
              alpha: parse(getComputedStyle(bgEl).backgroundColor)?.a ?? 1,
              contrast: Math.round(ratio(text, background) * 100) / 100,
            };
          };
          return {
            dark: document.body.hasAttribute('data-ds-dark-theme'),
            body: {
              background: getComputedStyle(document.body).backgroundColor,
              color: getComputedStyle(document.body).color,
            },
            searchInput: sample('.dsg-search-input'),
            searchResults: sample('.dsg-search-results', '.dsg-search-results'),
            searchResultRow: sample('.dsg-search-result', '.dsg-search-result-title', '.dsg-search-results'),
            menu: sample('.dsg-menu', '.dsg-menu-item'),
            dialog: sample('.dsg-dialog', '.dsg-dialog-title'),
            dialogInput: sample('.dsg-dialog-input'),
            viewOptions: sample('.dsg-view-options-popover', '.dsg-view-option', '.dsg-view-options-popover'),
          };
        })()`);

        const assertSurface = (label, surface) => {
          if (!surface || surface.missing) throw new Error(`${label} surface missing: ${JSON.stringify(surface)}`);
          const [r, g, b] = surface.background;
          if (r >= 250 && g >= 250 && b >= 250) {
            throw new Error(`${label} background must not be white in dark theme (got rgb(${r},${g},${b}))`);
          }
          if (!(surface.contrast >= 4.5)) {
            throw new Error(`${label} text contrast too low in dark theme: ${surface.contrast}:1 (bg=${surface.background}, text=${surface.text})`);
          }
        };

        await ui.fillSearch(state.searchTitle ?? 'Projects');
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(SEARCH_RESULTS)})`, 'dark-theme search dropdown open', 8000);
        await ui.waitFor(`document.querySelectorAll(${JSON.stringify(SEARCH_RESULT)}).length > 0`, 'dark-theme search results rendered', 8000);
        await sleep(120);
        const searchSurfaces = await readSurfaces();
        if (!searchSurfaces.dark) throw new Error('body[data-ds-dark-theme] was not applied');
        assertSurface('search input', searchSurfaces.searchInput);
        assertSurface('search dropdown', searchSurfaces.searchResults);
        assertSurface('search result row', searchSurfaces.searchResultRow);

        await ui.fillSearch('');
        await ui.closeSearch();

        const menuRow = (await ui.sessions()).find((row) => row.archived !== true);
        if (!menuRow) throw new Error('no non-archived session row available to open the dark-theme menu');
        await ui.openSessionMenu(menuRow.sid);
        await sleep(120);
        const menuSurfaces = await readSurfaces();
        assertSurface('session menu', menuSurfaces.menu);
        await driver.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
        await ui.waitFor(`!document.querySelector(${JSON.stringify(MENU)})`, 'dark-theme menu closed', 5000);

        await ui.click('[data-testid="session-groups-new-group"]');
        await ui.waitFor(`!!document.querySelector(${JSON.stringify(DIALOG_INPUT)})`, 'dark-theme dialog open', 5000);
        await sleep(120);
        const dialogSurfaces = await readSurfaces();
        assertSurface('dialog card', dialogSurfaces.dialog);
        assertSurface('dialog input', dialogSurfaces.dialogInput);
        await driver.evaluate(`document.querySelector('.dsg-dialog-cancel')?.click()`);
        await ui.waitFor(`!document.querySelector(${JSON.stringify(DIALOG)})`, 'dark-theme dialog closed', 5000);

        await ui.openViewOptions();
        await sleep(120);
        const optionsSurfaces = await readSurfaces();
        assertSurface('view-options popover', optionsSurfaces.viewOptions);
        await ui.closeViewOptions();

        if (!hadDark) await driver.evaluate(`document.body.removeAttribute('data-ds-dark-theme')`);
        await sleep(150);

        return {
          hadDark,
          search: {
            input: searchSurfaces.searchInput,
            dropdown: searchSurfaces.searchResults,
            result: searchSurfaces.searchResultRow,
          },
          menu: menuSurfaces.menu,
          dialog: dialogSurfaces.dialog,
          dialogInput: dialogSurfaces.dialogInput,
          viewOptions: optionsSurfaces.viewOptions,
          body: searchSurfaces.body,
          restoredDarkAttribute: hadDark,
        };
      },
    },
    {
      id: 18,
      name: 'optimistic-drop-commits-and-insertion-placeholders',
      async run() {
        // 0.2.4: every insertion point must render a real row-height placeholder
        // (32px session / 34px group) instead of a 2px border, and drops must
        // move the row in the DOM before the delayed commit HTTP completes.
        if (!(await ui.exists(VIEW))) throw new Error('step 18 must start in the groups view');
        await ui.closeViewOptions();
        await ui.closeSearch();
        await ui.dismissOverlay();
        const sessionRow = (sid) => `${SESSION}[data-session-id="${sid}"]`;
        const groupRow = (gid) => `${GROUP}[data-group-id="${gid}"]`;

        const assertPlaceholder = (info, expected, label) => {
          if (!info) throw new Error(`${label}: insertion placeholder missing`);
          if (info.kind !== expected.kind) throw new Error(`${label}: kind expected ${expected.kind}, got ${info.kind}`);
          if (expected.target !== undefined && info.target !== expected.target) {
            throw new Error(`${label}: target expected ${expected.target}, got ${info.target}`);
          }
          if (Math.abs(info.height - expected.height) > 1.5) {
            throw new Error(`${label}: height expected ${expected.height} ±1.5, got ${info.height}`);
          }
          if (!info.label) throw new Error(`${label}: placeholder label must not be empty`);
          if (info.borderStyle !== 'dashed') throw new Error(`${label}: expected a dashed accent border, got ${info.borderStyle}`);
          if (!info.background || info.background === 'rgba(0, 0, 0, 0)' || info.background === 'transparent') {
            throw new Error(`${label}: placeholder needs a visible accent surface, got ${info.background}`);
          }
        };

        // Pick live rows (step 14 reordered/reparented the tree).
        const rootIds = await ui.rootGroupIds();
        if (rootIds.length < 2) throw new Error(`need >=2 root groups for placeholder checks, got ${JSON.stringify(rootIds)}`);
        let groupId = null;
        let sessions = [];
        for (const gid of rootIds) {
          const ids = await ui.sessionIdsInGroup(gid);
          if (ids.length >= 2) {
            groupId = gid;
            sessions = ids;
            break;
          }
        }
        if (!groupId) throw new Error('no root group holds >=2 sessions for the placeholder/optimistic checks');
        const [firstSession, secondSession] = sessions;
        const otherGroupId = rootIds.find((gid) => gid !== groupId);
        const dragGroupId = rootIds.find((gid) => gid !== groupId && gid !== otherGroupId) ?? rootIds.find((gid) => gid !== groupId);

        // (1) session-before: 32px placeholder, following row physically pushed down.
        const firstBefore = await ui.rect(sessionRow(firstSession));
        await ui.beginSessionDrag(secondSession);
        await ui.dragHover(sessionRow(firstSession), 0.2);
        const sessionBefore = await ui.placeholderInfo();
        assertPlaceholder(sessionBefore, { kind: 'session-before', target: firstSession, height: 32 }, 'session-before');
        const firstAfterShift = await ui.rect(sessionRow(firstSession));
        if (!(firstAfterShift.top - firstBefore.top >= 28)) {
          throw new Error(`session-before placeholder must push the target row down ~32px (before=${firstBefore.top}, after=${firstAfterShift.top})`);
        }
        await ui.dragLeave(sessionRow(firstSession));
        await ui.waitNoPlaceholder('session-before cleared on dragleave');
        // (2) session-after: 32px placeholder after the target row.
        await ui.dragHover(sessionRow(firstSession), 0.8);
        const sessionAfter = await ui.placeholderInfo();
        assertPlaceholder(sessionAfter, { kind: 'session-after', target: firstSession, height: 32 }, 'session-after');
        const firstRect = await ui.rect(sessionRow(firstSession));
        if (!(sessionAfter.top >= firstRect.bottom - 1)) throw new Error('session-after placeholder must sit below the target row');
        await ui.dragLeave(sessionRow(firstSession));
        await ui.waitNoPlaceholder('session-after cleared on dragleave');
        await ui.endDrag();

        // (3) group-before / group-after: 34px group-row placeholders.
        const targetBefore = await ui.rect(groupRow(groupId));
        await ui.beginGroupDrag(dragGroupId);
        await ui.dragHover(groupRow(groupId), 0.2);
        const groupBefore = await ui.placeholderInfo();
        assertPlaceholder(groupBefore, { kind: 'group-before', target: groupId, height: 34 }, 'group-before');
        const targetAfterShift = await ui.rect(groupRow(groupId));
        if (!(targetAfterShift.top - targetBefore.top >= 30)) {
          throw new Error(`group-before placeholder must push the target row down ~34px (before=${targetBefore.top}, after=${targetAfterShift.top})`);
        }
        await ui.dragLeave(groupRow(groupId));
        await ui.waitNoPlaceholder('group-before cleared on dragleave');
        await ui.dragHover(groupRow(otherGroupId), 0.8);
        const groupAfter = await ui.placeholderInfo();
        assertPlaceholder(groupAfter, { kind: 'group-after', target: otherGroupId, height: 34 }, 'group-after');
        const otherRect = await ui.rect(groupRow(otherGroupId));
        if (!(groupAfter.top >= otherRect.bottom - 1)) throw new Error('group-after placeholder must sit below the target group row');
        await ui.dragLeave(groupRow(otherGroupId));
        await ui.waitNoPlaceholder('group-after cleared on dragleave');
        await ui.endDrag();

        // (4) group child slot: the 6px slot expands to a 34px placeholder.
        const slotSelector = `${GROUP_DROP}[data-parent-id="${groupId}"][data-before-group-id=""]`;
        await ui.beginGroupDrag(dragGroupId);
        await ui.dragHover(slotSelector, 0.5);
        const childPlaceholder = await ui.placeholderInfo();
        assertPlaceholder(childPlaceholder, { kind: 'group-child', target: groupId, height: 34 }, 'group-child');
        const activeSlot = await ui.rect(slotSelector);
        if (!(activeSlot.height >= 33)) throw new Error(`active child slot expected >=33px, got ${activeSlot.height}`);
        await ui.dragLeave(slotSelector);
        await ui.waitNoPlaceholder('group-child cleared on dragleave');
        await ui.endDrag();

        // (5) group-append (expanded): placeholder at the end of the group body.
        await ui.beginSessionDrag(firstSession);
        await ui.dragHover(groupRow(groupId), 0.5);
        const appendExpanded = await ui.placeholderInfo();
        assertPlaceholder(appendExpanded, { kind: 'group-append', target: groupId, height: 34 }, 'group-append expanded');
        const groupSessions = await ui.sessionIdsInGroup(groupId);
        const lastSessionRect = await ui.rect(sessionRow(groupSessions[groupSessions.length - 1]));
        if (!(appendExpanded.top >= lastSessionRect.bottom - 1)) {
          throw new Error('expanded group-append placeholder must sit after the last session row');
        }
        await ui.dragLeave(groupRow(groupId));
        await ui.waitNoPlaceholder('group-append cleared on dragleave');
        await ui.endDrag();

        // (6) group-append (collapsed): placeholder directly after the group row.
        // Use a session outside the group as the drag source; collapsing hides
        // the group's own rows.
        const ungroupedIds = await ui.ungroupedSessionIds();
        const otherGroupRows = (await ui.sessions()).filter((row) => row.groupId && row.groupId !== groupId);
        const externalDragSession = ungroupedIds[0] ?? otherGroupRows[0]?.sid ?? null;
        if (!externalDragSession) throw new Error('collapsed append check needs a session outside the collapsed group');
        await sleep(450);
        await ui.click(groupRow(groupId));
        await ui.waitFor(`document.querySelector(${JSON.stringify(groupRow(groupId))})?.getAttribute('data-expanded') === 'false'`, 'group collapsed for append check', 5000);
        await sleep(150);
        await ui.beginSessionDrag(externalDragSession);
        await ui.dragHover(groupRow(groupId), 0.5);
        const appendCollapsed = await ui.placeholderInfo();
        assertPlaceholder(appendCollapsed, { kind: 'group-append', target: groupId, height: 34 }, 'group-append collapsed');
        const collapsedRect = await ui.rect(groupRow(groupId));
        if (!(appendCollapsed.top >= collapsedRect.bottom - 1)) throw new Error('collapsed group-append placeholder must sit after the collapsed row');
        await ui.dragLeave(groupRow(groupId));
        await ui.waitNoPlaceholder('collapsed append cleared on dragleave');
        await ui.endDrag();
        await ui.click(groupRow(groupId));
        await ui.waitFor(`document.querySelector(${JSON.stringify(groupRow(groupId))})?.getAttribute('data-expanded') === 'true'`, 'group re-expanded', 5000);
        await sleep(150);

        // (7) ungrouped / root-end.
        await ui.beginSessionDrag(firstSession);
        await ui.dragHover(UNGROUPED, 0.5);
        const ungroupedPlaceholder = await ui.placeholderInfo();
        assertPlaceholder(ungroupedPlaceholder, { kind: 'ungrouped', height: 32 }, 'ungrouped');
        const ungroupedRect = await ui.rect(UNGROUPED);
        if (!(ungroupedPlaceholder.top >= ungroupedRect.bottom - 1)) throw new Error('ungrouped placeholder must sit under the ungrouped header');
        await ui.dragLeave(UNGROUPED);
        await ui.waitNoPlaceholder('ungrouped cleared on dragleave');
        await ui.endDrag();

        await ui.beginGroupDrag(dragGroupId);
        await ui.dragHover(UNGROUPED, 0.5);
        const rootEndPlaceholder = await ui.placeholderInfo();
        assertPlaceholder(rootEndPlaceholder, { kind: 'group-root-end', height: 34 }, 'group-root-end');
        const lastRootRect = await ui.rect(groupRow(rootIds[rootIds.length - 1]));
        if (!(rootEndPlaceholder.top >= lastRootRect.bottom - 1)) throw new Error('group-root-end placeholder must sit after the last root group');
        await ui.dragLeave(UNGROUPED);
        await ui.waitNoPlaceholder('root-end cleared on dragleave');
        await ui.endDrag();

        // (8) 264px: the placeholder never causes horizontal overflow.
        const widthBefore = await ui.sidebarWidth();
        const waitWidth = async (expected, label, waitMs = 8000) => {
          const end = Date.now() + waitMs;
          let last = -1;
          while (Date.now() < end) {
            last = await ui.sidebarWidth();
            if (Number.isFinite(last) && Math.abs(last - expected) <= 2) return last;
            await sleep(120);
          }
          throw new Error(`${label}: expected ${expected} ±2px, got ${last}`);
        };
        await ui.dragResizeHandle(264);
        const probeWidth = await waitWidth(264, 'sidebar width for placeholder overflow probe');
        await ui.beginSessionDrag(secondSession);
        await ui.dragHover(sessionRow(firstSession), 0.2);
        const narrowPlaceholder = await ui.placeholderInfo();
        const treeBox = await driver.evaluate(`(() => { const tree = document.querySelector('.dsg-tree'); return tree ? { clientWidth: tree.clientWidth, scrollWidth: tree.scrollWidth } : null; })()`);
        if (!narrowPlaceholder || !treeBox) throw new Error('264px placeholder probe lost its nodes');
        if (treeBox.scrollWidth > treeBox.clientWidth + 1) {
          throw new Error(`tree overflows at 264px with an active placeholder: ${treeBox.scrollWidth} > ${treeBox.clientWidth}`);
        }
        if (narrowPlaceholder.width > treeBox.clientWidth + 1) {
          throw new Error(`placeholder overflows at 264px: ${narrowPlaceholder.width} > ${treeBox.clientWidth}`);
        }
        await ui.dragLeave(sessionRow(firstSession));
        await ui.endDrag();
        await ui.dragResizeHandle(widthBefore);
        const widthRestored = await waitWidth(widthBefore, 'sidebar width restored after placeholder probe');

        // (9) Optimistic session move: DOM reorders while the commit response is
        // held by browser-network latency (CDP, no page fetch wrapper).
        const readRecordRevision = () => {
          try {
            return Number(JSON.parse(readFileSync(join(QA_HOME, 'storages', 'dsh-session-groups.json'), 'utf8')).revision);
          } catch {
            return -1;
          }
        };
        const waitRecordRevisionAbove = async (previous, description, waitMs = 12000) => {
          const end = Date.now() + waitMs;
          let last = -1;
          while (Date.now() < end) {
            last = readRecordRevision();
            if (last > previous) return last;
            await sleep(150);
          }
          throw new Error(`${description}: record revision stayed ${last} (expected > ${previous})`);
        };
        const orderBefore = await ui.sessionIdsInGroup(groupId);
        if (orderBefore.length < 2) throw new Error('optimistic session check needs >=2 sessions');
        const sessionRevisionBefore = readRecordRevision();
        await ui.beginCommitHold();
        const sessionDropAt = Date.now();
        await ui.beginSessionDrag(orderBefore[1]);
        await ui.dragHover(sessionRow(orderBefore[0]), 0.2);
        await ui.dragDrop(sessionRow(orderBefore[0]), 0.2);
        await ui.waitFor(
          `document.querySelector(${JSON.stringify(`${SESSION}[data-group-id="${groupId}"]`)})?.getAttribute('data-session-id') === ${JSON.stringify(orderBefore[1])}`,
          'optimistic session DOM order before HTTP',
          5000,
        );
        const optimisticOrder = await ui.sessionIdsInGroup(groupId);
        const optimisticSessionMs = Date.now() - sessionDropAt;
        if (optimisticOrder[0] !== orderBefore[1]) {
          throw new Error(`optimistic session move did not reorder the DOM before HTTP: ${JSON.stringify(orderBefore)} -> ${JSON.stringify(optimisticOrder)}`);
        }
        const optimisticFlag = await ui.attrs(VIEW, 'data-optimistic');
        if (optimisticFlag[0] !== 'true') throw new Error(`optimistic view flag expected true while the write is pending, got ${optimisticFlag[0]}`);
        await ui.waitHeldCommit(1);
        const sessionRevisionDuring = readRecordRevision();
        if (sessionRevisionDuring !== sessionRevisionBefore) {
          throw new Error(`session move hit the record file before the HTTP assertion (revision ${sessionRevisionBefore} -> ${sessionRevisionDuring})`);
        }
        const releasedSession = await ui.releaseHeldCommits();
        if (releasedSession < 1) throw new Error('session commit was not held by the CDP Fetch interceptor');
        await ui.waitFor(`document.querySelector(${JSON.stringify(VIEW)})?.getAttribute('data-optimistic') === 'false'`, 'session optimistic reconcile settled', 8000);
        const sessionRevisionAfter = await waitRecordRevisionAbove(sessionRevisionBefore, 'session optimistic commit persisted');
        await sleep(250);
        const settledSession = await ui.sessionIdsInGroup(groupId);
        if (settledSession[0] !== orderBefore[1]) throw new Error('session order changed after the commit reconciled');

        // (10) Optimistic group move: root order swaps while the commit is held.
        const rootsBefore = await ui.rootGroupIds();
        if (rootsBefore.length < 2) throw new Error('optimistic group check needs >=2 root groups');
        const groupRevisionBefore = readRecordRevision();
        await ui.beginCommitHold();
        const groupDropAt = Date.now();
        await ui.dragGroup({ kind: 'after', dragged: rootsBefore[0], target: rootsBefore[1] });
        await ui.waitFor(
          `document.querySelectorAll(${JSON.stringify(`${GROUP}[data-depth="0"]`)})[0]?.getAttribute('data-group-id') === ${JSON.stringify(rootsBefore[1])}`,
          'optimistic root order before HTTP',
          5000,
        );
        const optimisticRoots = await ui.rootGroupIds();
        const optimisticGroupMs = Date.now() - groupDropAt;
        if (optimisticRoots[0] !== rootsBefore[1] || optimisticRoots[1] !== rootsBefore[0]) {
          throw new Error(`optimistic group move did not reorder roots before HTTP: ${JSON.stringify(rootsBefore)} -> ${JSON.stringify(optimisticRoots)}`);
        }
        if ((await ui.attrs(VIEW, 'data-optimistic'))[0] !== 'true') throw new Error('optimistic view flag expected true during the group write');
        await ui.waitHeldCommit(1);
        const groupRevisionDuring = readRecordRevision();
        if (groupRevisionDuring !== groupRevisionBefore) {
          throw new Error(`group move hit the record file before the HTTP assertion (revision ${groupRevisionBefore} -> ${groupRevisionDuring})`);
        }
        const releasedGroup = await ui.releaseHeldCommits();
        if (releasedGroup < 1) throw new Error('group commit was not held by the CDP Fetch interceptor');
        await ui.waitFor(`document.querySelector(${JSON.stringify(VIEW)})?.getAttribute('data-optimistic') === 'false'`, 'group optimistic reconcile settled', 8000);
        const groupRevisionAfter = await waitRecordRevisionAbove(groupRevisionBefore, 'group optimistic commit persisted');
        await sleep(250);
        const settledRoots = await ui.rootGroupIds();
        if (settledRoots[0] !== rootsBefore[1]) throw new Error('root order changed after the group commit reconciled');

        // (11) 0.2.5 diagnostics HUD must be present, plain DOM and fed by the
        // drags above (native dragover count > 0) without React renders.
        const hud = await driver.evaluate(`(() => {
          const el = document.querySelector('[data-testid="session-groups-diagnostics-hud"]');
          return el ? { text: el.textContent, runId: el.getAttribute('data-run-id'), pointerEvents: getComputedStyle(el).pointerEvents } : null;
        })()`);
        if (!hud) throw new Error('0.2.5 diagnostics HUD is missing');
        if (!/dsg 0\.2\.5/.test(hud.text)) throw new Error(`diagnostics HUD build line missing: ${JSON.stringify(hud.text)}`);
        if (hud.pointerEvents !== 'none') throw new Error(`diagnostics HUD must be pointer-events:none, got ${hud.pointerEvents}`);
        const hudNative = /n=(\d+)/.exec(hud.text);
        if (!hudNative || Number(hudNative[1]) <= 0) throw new Error(`diagnostics HUD native dragover count missing/zero: ${JSON.stringify(hud.text)}`);
        if (!/chg=\d+/.test(hud.text) || !/rend=\d+/.test(hud.text)) throw new Error(`diagnostics HUD counters missing: ${JSON.stringify(hud.text)}`);

        return {
          diagnostics: { runId: hud.runId, text: hud.text },
          placeholders: {
            sessionBefore: { height: sessionBefore.height, label: sessionBefore.label, pushed: Math.round(firstAfterShift.top - firstBefore.top) },
            sessionAfter: { height: sessionAfter.height, label: sessionAfter.label },
            groupBefore: { height: groupBefore.height, label: groupBefore.label, pushed: Math.round(targetAfterShift.top - targetBefore.top) },
            groupAfter: { height: groupAfter.height, label: groupAfter.label },
            groupChild: { height: childPlaceholder.height, slotHeight: activeSlot.height, label: childPlaceholder.label },
            groupAppendExpanded: { height: appendExpanded.height, label: appendExpanded.label },
            groupAppendCollapsed: { height: appendCollapsed.height, label: appendCollapsed.label },
            ungrouped: { height: ungroupedPlaceholder.height, label: ungroupedPlaceholder.label },
            rootEnd: { height: rootEndPlaceholder.height, label: rootEndPlaceholder.label },
            narrow264: { width: probeWidth, tree: treeBox, placeholderWidth: narrowPlaceholder.width, restored: widthRestored },
          },
          optimistic: {
            session: {
              optimisticMs: optimisticSessionMs,
              revisionBefore: sessionRevisionBefore,
              revisionDuring: sessionRevisionDuring,
              revisionAfter: sessionRevisionAfter,
              before: orderBefore,
              after: optimisticOrder,
            },
            group: {
              optimisticMs: optimisticGroupMs,
              revisionBefore: groupRevisionBefore,
              revisionDuring: groupRevisionDuring,
              revisionAfter: groupRevisionAfter,
              before: rootsBefore,
              after: optimisticRoots,
              settled: settledRoots,
            },
          },
        };
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

/**
 * 0.2.5 diagnostics persistence check (outside the 18 acceptance steps):
 * POST a probe batch through the real client/host route, then read the NDJSON
 * file from the isolated home and assert the drag trace was appended there.
 * This is the only place the E2E runner verifies the host route + file write.
 */
async function verifyDiagnostics(driver) {
  const file = join(QA_HOME, 'storages', 'dsh-session-groups.diagnostics.ndjson');
  const probe = await driver.evaluate(`(async () => {
    try {
      const response = await fetch('dsh-session-groups/diagnostics', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId: 'e2e-probe', schemaVersion: 1, events: [{ type: 'e2e.probe', t: 0 }] }),
      });
      return { ok: response.ok, status: response.status, body: await response.json() };
    } catch (error) {
      return { ok: false, status: 0, error: String(error?.message ?? error) };
    }
  })()`, { awaitPromise: true });
  if (probe?.ok !== true) return { ok: false, stage: 'route', probe, file };
  const end = Date.now() + 10000;
  let text = null;
  while (Date.now() < end) {
    try {
      text = readFileSync(file, 'utf8');
      if (text.includes('e2e-probe') && text.includes('native.')) break;
    } catch {
      /* not flushed yet */
    }
    await sleep(200);
  }
  if (text === null) return { ok: false, stage: 'file-missing', probe, file };
  const lines = text.trimEnd().split('\n').filter(Boolean);
  const records = [];
  const invalid = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch {
      invalid.push(line.slice(0, 80));
    }
  }
  const runs = [...new Set(records.map((record) => record.runId).filter(Boolean))];
  const clientRecords = records.filter((record) => record.runId !== 'e2e-probe');
  const probeSeen = records.some((record) => record.runId === 'e2e-probe' && record.schemaVersion === 1);
  const nativeSeen = clientRecords.some((record) => String(record.event?.type ?? '').startsWith('native.'));
  const handlerSeen = clientRecords.some((record) => record.event?.type === 'handler');
  const optimisticSeen = clientRecords.some((record) => String(record.event?.type ?? '').startsWith('optimistic.') || String(record.event?.type ?? '').startsWith('queue.'));
  const result = {
    ok: probeSeen && nativeSeen && handlerSeen && invalid.length === 0,
    probe,
    file,
    lineCount: records.length,
    invalidLines: invalid,
    runIds: runs,
    probeSeen,
    nativeSeen,
    handlerSeen,
    optimisticSeen,
    sampleTypes: [...new Set(clientRecords.map((record) => record.event?.type))].slice(0, 30),
  };
  return result;
}
// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);
  if (args.qaHome) QA_HOME = resolve(args.qaHome);
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
  console.log(' V1 E2E - 18-step acceptance (isolated DSH home, CDP)');
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

    if (!failed && !evidence.blockedReason) {
      // 0.2.5: the diagnostics route + isolated-home NDJSON write must work with
      // the real drag trace; this is not an acceptance step (still 18/18).
      try {
        const diagnostics = await verifyDiagnostics(driver);
        evidence.diagnostics = diagnostics;
        if (!diagnostics.ok) {
          failed = true;
          evidence.result = 'FAIL';
          console.error(`  [FAIL] diagnostics persistence: ${JSON.stringify(diagnostics).slice(0, 800)}`);
        } else {
          console.log(
            `  [PASS] diagnostics persistence: lines=${diagnostics.lineCount} runs=${diagnostics.runIds.length} native=${diagnostics.nativeSeen} handler=${diagnostics.handlerSeen} optimistic=${diagnostics.optimisticSeen}`
          );
        }
      } catch (error) {
        failed = true;
        evidence.result = 'FAIL';
        evidence.diagnostics = { ok: false, error: String(error?.message ?? error) };
        console.error(`  [FAIL] diagnostics persistence check threw: ${error?.message ?? error}`);
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

















