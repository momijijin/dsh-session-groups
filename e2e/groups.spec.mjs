#!/usr/bin/env node
// e2e/groups.spec.mjs
//
// V1 E2E acceptance (docs/TEST-PLAN.md §5, 12 steps) - zero-dependency.
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
// Exit codes: 0 = all 12 steps PASS, 1 = a step FAILED, 2 = harness error,
//             3 = BLOCKED (client build / plugin UI missing).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

function spawnPwsh(script, args) {
  return spawnSync('pwsh', ['-NoProfile', '-File', script, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 300000,
  });
}

// ---------------------------------------------------------------------------
// UI helpers (single source for selectors / gestures)
// ---------------------------------------------------------------------------
function makeUi(driver, helpers) {
  const { timeoutMs } = helpers;

  const evaluate = (expression, options) => driver.evaluate(expression, options);
  const waitFor = (expression, description, waitMs = timeoutMs) => driver.waitFor(expression, { timeoutMs: waitMs, description });

  const ui = {
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
      // The preview notice can mount a moment after the shell boots; retry briefly.
      for (let attempt = 0; attempt < 12; attempt++) {
        const clicked = await evaluate(`(() => {
          const button = Array.from(document.querySelectorAll('button')).find((el) => /^(Continue|继续|知道了|关闭)$/i.test((el.textContent ?? '').trim()));
          if (!button) return false;
          button.click();
          return true;
        })()`);
        if (!clicked) return attempt > 0;
        await sleep(350);
      }
      return true;
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
      await waitFor(`!!document.querySelector(${JSON.stringify(DIALOG_INPUT)})`, 'dialog input');
      await ui.setNativeValue(DIALOG_INPUT, value);
    },
    async confirmDialog() {
      await ui.click(DIALOG_CONFIRM);
      await waitFor(`!document.querySelector(${JSON.stringify(DIALOG)})`, 'dialog closed');
    },
    async createGroup(name, trigger = 'new-group') {
      if (trigger === 'new-group') await ui.click('[data-testid="session-groups-new-group"]');
      await ui.fillDialog(name);
      await ui.confirmDialog();
      await waitFor(`Array.from(document.querySelectorAll(${JSON.stringify(GROUP)}), (el) => (el.textContent ?? '')).some((t) => t.includes(${JSON.stringify(name)}))`, `group '${name}' visible`);
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
      await waitFor(`Array.from(document.querySelectorAll(${JSON.stringify(GROUP)}), (el) => (el.textContent ?? '')).some((t) => t.includes(${JSON.stringify(name)}))`, `child group '${name}' visible`);
      return ui.groupIdByName(name);
    },
    async toggleMode() {
      await ui.click(TOGGLE);
      await sleep(300);
    },
    async waitGroupsView() {
      await waitFor(`!!document.querySelector(${JSON.stringify(VIEW)})`, 'groups view mounted');
    },
    async waitWorkspaceView() {
      await waitFor(`!document.querySelector(${JSON.stringify(VIEW)})`, 'official workspace view restored');
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
      const source = String(pattern);
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
    const stop = spawnPwsh(join(SCRIPTS_QA, 'stop-web.ps1'), ['-Port', String(args.port), '-QaHome', QA_HOME, '-EvidenceDir', evidenceDir]);
    if (stop.status !== 0) throw new Error(`stop-web failed: ${stop.stderr || stop.stdout}`);
    const start = spawnPwsh(join(SCRIPTS_QA, 'start-web.ps1'), ['-Port', String(args.port), '-QaHome', QA_HOME, '-EvidenceDir', evidenceDir]);
    if (start.status !== 0) throw new Error(`start-web failed: ${start.stderr || start.stdout}`);
    const stateNow = webState(evidenceDir);
    if (!stateNow?.url) throw new Error('web.json missing token url after restart');
    await driver.navigate(stateNow.url);
    await driver.waitFor(`typeof globalThis.__DSH_BOOT__ !== 'undefined'`, { timeoutMs: 30000, description: 'app boot after restart' });
    await ui.dismissOverlay();
    await sleep(500);
  };

  const runAudit = (extraArgs) => spawnPwsh(join(SCRIPTS_QA, 'audit.ps1'), [
    '-Mode', 'verify',
    '-QaHome', QA_HOME,
    '-Port', String(args.port),
    '-EvidenceDir', evidenceDir,
    ...extraArgs,
  ]);

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
        const before = await ui.ungroupedSessionIds();
        if (before.length < 10) throw new Error(`fixtures expose only ${before.length} ungrouped session rows; need >=10 for the 10-session drag step`);
        const picks = before.slice(0, 10);
        const { a, child, b } = state.groups;
        const plan = [
          ...picks.slice(0, 4).map((sid) => [sid, a]),
          ...picks.slice(4, 7).map((sid) => [sid, child]),
          ...picks.slice(7, 10).map((sid) => [sid, b]),
        ];
        for (const [sid, gid] of plan) await ui.dragSessionToGroup(sid, gid);
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
        const target = state.createdSession ?? (await ui.sessions()).find((row) => row.groupId)?.sid;
        if (!target) throw new Error('no session available to archive');
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
        if (onlyRows.some((row) => row.sid !== target && row.groupId === targetGroup)) {
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
        return { session: target, group: targetGroup };
      },
    },
    {
      id: 8,
      name: 'rename-syncs-with-official-sidebar',
      async run() {
        const target = state.createdSession ?? (await ui.sessions()).find((row) => row.groupId)?.sid;
        if (!target) throw new Error('no session available to rename');
        await ui.openSessionMenu(target);
        const items = await ui.menuItems();
        if (!items.some((text) => /重命名/.test(text))) throw new Error(`session menu has no rename entry (items: ${JSON.stringify(items.slice(0, 20))})`);
        if (items.some((text) => /删除/.test(text))) throw new Error('session menu must not offer delete (D5)');
        await ui.clickMenuItem(/重命名|Rename/);
        const newTitle = `E2E-重命名-${Date.now().toString(36).slice(-4)}`;
        await ui.fillDialog(newTitle);
        await ui.confirmDialog();
        await waitFor(`Array.from(document.querySelectorAll(${JSON.stringify(SESSION)}), (el) => (el.textContent ?? '')).some((t) => t.includes(${JSON.stringify(newTitle)}))`, 'renamed row shows new title');
        await ui.toggleMode();
        await ui.waitWorkspaceView();
        await sleep(500);
        const body = await ui.bodyText();
        if (!body.includes(newTitle)) throw new Error(`official sidebar did not show renamed title '${newTitle}' (second title source?)`);
        state.renamedTitle = newTitle;
        return { session: target, title: newTitle };
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
        const reordered = state.reordered?.order;
        if (reordered?.length) {
          const actual = await ui.sessionIdsInGroup(state.reordered.group);
          if (JSON.stringify(actual) !== JSON.stringify(reordered)) {
            throw new Error(`group order not persisted across restart: ${JSON.stringify(reordered)} -> ${JSON.stringify(actual)}`);
          }
        }
        const afterFilter = await ui.filterState();
        if (beforeFilter && afterFilter && beforeFilter !== afterFilter) {
          throw new Error(`archive filter not persisted: ${beforeFilter} -> ${afterFilter}`);
        }
        if (state.renamedTitle) {
          const body = await ui.bodyText();
          if (!body.includes(state.renamedTitle)) throw new Error('renamed title lost after restart');
        }
        return { groups: afterGroups.length, filter: afterFilter };
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
  ];
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
  console.log(' V1 E2E - 12-step acceptance (isolated .spike-homes/qa, CDP)');
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
      await driver.screenshot(join(evidenceDir, 'screenshots', 'e2e', '00-blocked-no-toggle.png')).catch(() => null);
      return 3;
    }

    const steps = makeSteps({ driver, ui, evidenceDir, args, state });
    for (const step of steps) {
      const started = Date.now();
      try {
        const detail = await step.run();
        const screenshot = await (args.screenshot
          ? driver.screenshot(join(evidenceDir, 'screenshots', 'e2e', `${String(step.id).padStart(2, '0')}-${step.name}.png`)).catch(() => null)
          : null);
        evidence.steps.push({ id: step.id, name: step.name, status: 'PASS', ms: Date.now() - started, detail, screenshot });
        console.log(`  [PASS] step ${step.id}: ${step.name}`);
      } catch (error) {
        const screenshot = await driver.screenshot(join(evidenceDir, 'screenshots', 'e2e', `${String(step.id).padStart(2, '0')}-${step.name}-FAIL.png`)).catch(() => null);
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





