#!/usr/bin/env node
// scripts/qa/probe-drag-perf.mjs
//
// Opt-in latency probe for the groups view drag/commit path (0.2.2).
//
// It drives the real isolated QA home (the same large fixture as the E2E) via
// CDP, enables the client probe through localStorage, and records:
//   * dragover dispatch + handler durations and the resulting render counts,
//   * drop-target setter calls vs actual target changes,
//   * frame intervals while hovering,
//   * drop -> commitDoc -> HTTP commit -> store doc -> next frame timelines.
//
// The same script runs against the pre-fix build and the fixed build so the
// report can compare identical phases on identical fixtures.
//
// Usage:
//   node scripts/qa/probe-drag-perf.mjs --label before --out scripts/qa/evidence/perf-before.json
//   node scripts/qa/probe-drag-perf.mjs --label after  --out scripts/qa/evidence/perf-after.json
//
// Exit codes: 0 = probe captured, 1 = a phase failed, 2 = harness error.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchDriver, sleep } from '../../e2e/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const DEFAULT_EVIDENCE = join(REPO_ROOT, 'scripts', 'qa', 'evidence');
const VIEW = '[data-testid="session-groups-view"]';
const SESSION = '[data-testid="session-groups-session"]';
const GROUP = '[data-testid="session-groups-group"]';
const UNGROUPED = '[data-testid="session-groups-ungrouped"]';
const DIALOG = '[data-testid="session-groups-dialog"]';
const DIALOG_INPUT = '[data-testid="session-groups-dialog-input"]';
const DIALOG_CONFIRM = '[data-testid="session-groups-dialog-confirm"]';

function parseArgs(argv) {
  const args = {
    evidenceDir: DEFAULT_EVIDENCE,
    out: join(DEFAULT_EVIDENCE, 'perf-probe.json'),
    label: 'probe',
    browser: 'auto',
    timeoutMs: 25000,
    groups: 3,
    drops: 9,
    hoverEvents: 120,
    pacedEvents: 30,
    holdEvents: 45,
    stressGroups: 0,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = () => argv[++i];
    if (key === '--evidence-dir') args.evidenceDir = next();
    else if (key === '--out') args.out = next();
    else if (key === '--label') args.label = next();
    else if (key === '--browser') args.browser = next();
    else if (key === '--timeout-ms') args.timeoutMs = Number(next());
    else if (key === '--groups') args.groups = Number(next());
    else if (key === '--drops') args.drops = Number(next());
    else if (key === '--hover-events') args.hoverEvents = Number(next());
    else if (key === '--paced-events') args.pacedEvents = Number(next());
    else if (key === '--hold-events') args.holdEvents = Number(next());
    else if (key === '--stress-groups') args.stressGroups = Number(next());
    else throw new Error(`unknown argument: ${key}`);
  }
  return args;
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const stats = (values) => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return { count: 0, min: 0, avg: 0, p50: 0, p95: 0, max: 0 };
  const at = (ratio) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)))];
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    min: Math.round(sorted[0] * 100) / 100,
    avg: Math.round((total / sorted.length) * 100) / 100,
    p50: Math.round(at(0.5) * 100) / 100,
    p95: Math.round(at(0.95) * 100) / 100,
    max: Math.round(sorted[sorted.length - 1] * 100) / 100,
  };
};

const frameStats = (times) => {
  const intervals = [];
  for (let index = 1; index < times.length; index += 1) intervals.push(times[index] - times[index - 1]);
  return { frames: times.length, intervalMs: stats(intervals) };
};

async function main() {
  const args = parseArgs(process.argv);
  const evidenceDir = resolve(args.evidenceDir);
  const web = readJson(join(evidenceDir, 'web.json'));
  if (!web?.url) throw new Error(`web.json missing a token url under ${evidenceDir}; run scripts/qa/start-web.ps1 first`);

  const evidence = {
    kind: 'drag-perf-probe',
    label: args.label,
    createdAt: new Date().toISOString(),
    qaHome: web.spikeHome ?? null,
    port: web.port ?? null,
    url: web.baseUrl ?? null,
    clientBuild: null,
    phases: {},
    result: 'FAIL',
  };
  try {
    const clientPath = join(REPO_ROOT, 'lib', 'client.js');
    evidence.clientBuild = { bytes: readFileSync(clientPath).length };
  } catch {
    /* build metadata is optional */
  }

  let driver = null;
  try {
    driver = await launchDriver({ browser: args.browser, timeoutMs: args.timeoutMs });
    const evaluate = (expression, options) => driver.evaluate(expression, options);
    const waitFor = (expression, description, waitMs = args.timeoutMs) =>
      driver.waitFor(expression, { timeoutMs: waitMs, description });

    const dismissOverlays = async () => {
      await evaluate(`(() => {
        const button = Array.from(document.querySelectorAll('button')).find((el) => /^(Continue|继续|知道了|关闭)$/i.test((el.textContent ?? '').trim()));
        if (button) button.click();
        for (const dialog of Array.from(document.querySelectorAll('[role="dialog"]'))) {
          const label = dialog.getAttribute('aria-label') ?? '';
          const text = (dialog.textContent ?? '').trim();
          if (!/get started|开始使用/i.test(label) && !/Add API Key|Sign in to your DeepSeek|添加 API Key/i.test(text)) continue;
          const close = dialog.querySelector('button[aria-label="Close"], button[aria-label="关闭"], button[title="Close"], button[title="关闭"]');
          if (close) close.click();
        }
        return true;
      })()`);
      await sleep(350);
    };

    const boot = async () => {
      await waitFor(`typeof globalThis.__DSH_BOOT__ !== 'undefined'`, 'app boot payload', 30000);
      await waitFor(`!!document.querySelector('#root') && document.querySelector('#root').children.length > 0`, 'React root', 30000);
      await dismissOverlays();
      await sleep(500);
    };

    const enterGroups = async () => {
      await waitFor(`!!document.querySelector('[data-testid="session-groups-toggle"]')`, 'footer view switch', 30000);
      // 0.2.2 has explicit segments; 0.2.1 had a single toggle button. Never
      // click when groups mode is already active: the old toggle would switch
      // back to the workspace view.
      await evaluate(`(() => {
        const toggle = document.querySelector('[data-testid="session-groups-toggle"]');
        if (toggle?.getAttribute('data-mode') === 'groups') return 'already-groups';
        const segment = document.querySelector('[data-testid="session-groups-toggle-groups"], [data-testid="session-groups-mode-groups"]');
        if (segment) { segment.click(); return 'segment'; }
        if (toggle) { toggle.click(); return 'toggle'; }
        return null;
      })()`);
      await waitFor(`!!document.querySelector(${JSON.stringify(VIEW)})`, 'groups view mounted');
      await waitFor(`document.querySelectorAll(${JSON.stringify(SESSION)}).length > 0`, 'session rows hydrated', 30000);
      await sleep(400);
    };

    await driver.navigate(web.url);
    await boot();
    // Enable the opt-in probe and reload so the client caches the flag at boot.
    await evaluate(`localStorage.setItem('dsh-session-groups.perf', '1')`);
    await driver.navigate(web.url);
    await boot();
    await enterGroups();

    const perfEnabled = await evaluate(`(() => {
      const api = globalThis.__dsgPerfApi;
      return !!(api && api.enabled && api.enabled());
    })()`);
    if (!perfEnabled) throw new Error('client perf probe is not enabled after reload');

    // Realistic tree shape: a few groups plus the ungrouped section.
    const createGroup = async (name) => {
      await evaluate(`document.querySelector('[data-testid="session-groups-new-group"]')?.click()`);
      await waitFor(`!!document.querySelector(${JSON.stringify(DIALOG)})`, `dialog for ${name}`);
      await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(DIALOG_INPUT)});
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, ${JSON.stringify(name)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await sleep(120);
      await evaluate(`document.querySelector(${JSON.stringify(DIALOG_CONFIRM)})?.click()`);
      await waitFor(`!document.querySelector(${JSON.stringify(DIALOG)})`, `dialog closed for ${name}`);
      await sleep(180);
    };
    const groupNames = [];
    for (let index = 0; index < args.groups; index += 1) {
      groupNames.push(`Perf-${String.fromCharCode(65 + index)}`);
      await createGroup(groupNames[index]);
    }
    await sleep(300);

    const state = {
      sessions: await evaluate(`document.querySelectorAll(${JSON.stringify(SESSION)}).length`),
      groups: await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(GROUP)} + '[data-depth="0"]'), (el) => ({ id: el.getAttribute('data-group-id'), text: (el.textContent ?? '').trim() }))`),
    };

    const resetProbe = async () => evaluate(`globalThis.__dsgPerfApi.reset()`);
    const startFrameProbe = async () => evaluate(`(() => {
      window.__dsgFrameProbe = { active: true, times: [] };
      const loop = (t) => {
        if (!window.__dsgFrameProbe.active) return;
        window.__dsgFrameProbe.times.push(t);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      return true;
    })()`);
    const stopFrameProbe = async () => evaluate(`(() => {
      window.__dsgFrameProbe.active = false;
      return window.__dsgFrameProbe.times;
    })()`);

    // --- phase 1: hovering without dropping --------------------------------
    await resetProbe();
    await startFrameProbe();
    const hover = await evaluate(`(() => {
      const sessions = Array.from(document.querySelectorAll(${JSON.stringify(SESSION)}));
      const groups = Array.from(document.querySelectorAll(${JSON.stringify(GROUP)}));
      const ungrouped = document.querySelector(${JSON.stringify(UNGROUPED)});
      const source = sessions[0] ?? null;
      if (!source || groups.length === 0) return { error: 'probe needs one source row and one group' };
      const targets = [];
      for (const group of groups.slice(0, 3)) targets.push({ el: group, ratio: 0.5, label: 'group-append' });
      for (const row of sessions.slice(1, 4)) {
        targets.push({ el: row, ratio: 0.2, label: 'session-before' });
        targets.push({ el: row, ratio: 0.8, label: 'session-after' });
      }
      if (ungrouped) targets.push({ el: ungrouped, ratio: 0.5, label: 'ungrouped' });
      const dt = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const rects = targets.map((target) => target.el.getBoundingClientRect());
      const total = ${Number(args.hoverEvents)};
      const events = [];
      for (let index = 0; index < total; index += 1) {
        const targetIndex = Math.min(targets.length - 1, Math.floor(index / 4) % targets.length);
        const target = targets[targetIndex];
        const rect = rects[targetIndex];
        const x = rect.left + rect.width / 2;
        const y = rect.top + Math.max(2, rect.height * target.ratio);
        const started = performance.now();
        target.el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
        events.push({ label: target.label, ms: Math.round((performance.now() - started) * 100) / 100 });
      }
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      return {
        events,
        targets: targets.map((target) => target.label),
        rows: sessions.length,
        groups: groups.length,
      };
    })()`);
    await sleep(500);
    const hoverFrames = await stopFrameProbe();
    const hoverSnapshot = await evaluate(`globalThis.__dsgPerfApi.snapshot()`);
    if (hover.error) throw new Error(`hover phase: ${hover.error}`);

    // --- phase 2: paced hovering (one event per frame) ---------------------
    await resetProbe();
    await startFrameProbe();
    const paced = [];
    const pacedSetup = await evaluate(`(() => {
      const sessions = Array.from(document.querySelectorAll(${JSON.stringify(SESSION)}));
      const groups = Array.from(document.querySelectorAll(${JSON.stringify(GROUP)}));
      const source = sessions[0] ?? null;
      if (!source || groups.length === 0) return { error: 'paced probe needs a source row and a group' };
      window.__dsgPacedDrag = { source, groups, sessions, dt: new DataTransfer() };
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dsgPacedDrag.dt }));
      return { ok: true };
    })()`);
    if (pacedSetup.error) throw new Error(`paced phase: ${pacedSetup.error}`);
    for (let index = 0; index < args.pacedEvents; index += 1) {
      const result = await evaluate(`(() => {
        const ctx = window.__dsgPacedDrag;
        const run = Math.floor(${Number(index)} / 4);
        const el = run % 2 === 0 ? ctx.groups[0] : ctx.sessions[1];
        if (!el) return { error: 'paced target missing' };
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height * 0.5;
        const started = performance.now();
        el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: ctx.dt, clientX: x, clientY: y }));
        return { ms: Math.round((performance.now() - started) * 100) / 100 };
      })()`);
      if (result?.error) throw new Error(`paced phase: ${result.error}`);
      paced.push(result);
      await sleep(16);
    }
    await evaluate(`(() => { const ctx = window.__dsgPacedDrag; ctx.source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: ctx.dt })); delete window.__dsgPacedDrag; return true; })()`);
    await sleep(300);
    const pacedFrames = await stopFrameProbe();
    const pacedSnapshot = await evaluate(`globalThis.__dsgPerfApi.snapshot()`);

    // --- phase 2b: hold on ONE row, one dragover per frame ------------------
    // Chrome keeps emitting dragover while the pointer rests on a row. This is
    // the shape users feel as "hover lag": the resolved target never changes.
    await resetProbe();
    await startFrameProbe();
    const holdSetup = await evaluate(`(() => {
      const group = document.querySelector('[data-testid="session-groups-group"]');
      const source = document.querySelectorAll('[data-testid="session-groups-session"]')[0];
      if (!group || !source) return { error: 'hold phase needs a group and a session' };
      window.__dsgHoldDrag = { group, source, dt: new DataTransfer() };
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dsgHoldDrag.dt }));
      return { ok: true };
    })()`);
    if (holdSetup.error) throw new Error(`hold phase: ${holdSetup.error}`);
    const hold = [];
    for (let index = 0; index < args.holdEvents; index += 1) {
      const result = await evaluate(`(() => {
        const ctx = window.__dsgHoldDrag;
        const rect = ctx.group.getBoundingClientRect();
        const started = performance.now();
        ctx.group.dispatchEvent(new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer: ctx.dt,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }));
        return { ms: Math.round((performance.now() - started) * 100) / 100 };
      })()`);
      hold.push(result);
      await sleep(16);
    }
    await evaluate(`(() => {
      const ctx = window.__dsgHoldDrag;
      ctx.source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: ctx.dt }));
      delete window.__dsgHoldDrag;
      return true;
    })()`);
    await sleep(300);
    const holdFrames = await stopFrameProbe();
    const holdSnapshot = await evaluate(`globalThis.__dsgPerfApi.snapshot()`);

    // --- phase 3: real drops + commit timeline -----------------------------
    await resetProbe();
    await evaluate(`window.__dsgDropTimes = []`);
    const dropGroups = Array.isArray(state.groups) ? state.groups.map((group) => group.id).filter(Boolean) : [];
    if (dropGroups.length === 0) throw new Error('drop phase needs at least one group');
    const dropResults = [];
    for (let index = 0; index < args.drops; index += 1) {
      const sid = await evaluate(`(() => {
        const row = Array.from(document.querySelectorAll(${JSON.stringify(SESSION)} + '[data-ungrouped="true"]'))[0]
          ?? Array.from(document.querySelectorAll(${JSON.stringify(SESSION)}))[${Number(index)}];
        return row ? row.getAttribute('data-session-id') : null;
      })()`);
      if (!sid) break;
      const gid = dropGroups[index % dropGroups.length];
      const dispatched = await evaluate(`(() => {
        const sid = ${JSON.stringify(sid)};
        const gid = ${JSON.stringify(gid)};
        const source = document.querySelector(${JSON.stringify(SESSION)} + '[data-session-id="' + sid + '"]');
        const target = document.querySelector(${JSON.stringify(GROUP)} + '[data-group-id="' + gid + '"]');
        if (!source || !target) return { ok: false, reason: 'source or target missing' };
        const dt = new DataTransfer();
        const rect = target.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
        for (let step = 0; step < 6; step += 1) {
          target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
        }
        const entry = { sid, gid, dropAt: performance.now(), doneAt: null };
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
        source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
        window.__dsgDropTimes.push(entry);
        return { ok: true };
      })()`);
      if (!dispatched.ok) throw new Error(`drop dispatch failed: ${dispatched.reason}`);
      const settled = await evaluate(`new Promise((resolve) => {
        const entry = window.__dsgDropTimes[window.__dsgDropTimes.length - 1];
        const deadline = performance.now() + 5000;
        const check = () => {
          const row = document.querySelector(${JSON.stringify(SESSION)} + '[data-session-id="' + entry.sid + '"]');
          if (row && row.getAttribute('data-group-id') === entry.gid) {
            requestAnimationFrame(() => {
              entry.doneAt = performance.now();
              resolve({ ok: true, commitMs: Math.round((entry.doneAt - entry.dropAt) * 100) / 100 });
            });
            return;
          }
          if (performance.now() > deadline) { resolve({ ok: false }); return; }
          setTimeout(check, 10);
        };
        check();
      })`, { awaitPromise: true });
      if (!settled?.ok) throw new Error(`drop ${sid} -> ${gid} did not settle within 5s`);
      dropResults.push({ sid, gid, commitMs: settled.commitMs });
      await sleep(120);
    }
    await sleep(400);
    const dropTimes = await evaluate(`window.__dsgDropTimes`);
    const dropSnapshot = await evaluate(`globalThis.__dsgPerfApi.snapshot()`);

    const renderCounts = (snapshot) => ({ ...(snapshot?.renders ?? {}) });
    const summarizePhase = (phase, snapshot, frames) => ({
      events: phase.events?.length ?? 0,
      eventMs: stats((phase.events ?? []).map((event) => event.ms)),
      eventLabels: (phase.events ?? []).reduce((acc, event) => {
        acc[event.label] = (acc[event.label] ?? 0) + 1;
        return acc;
      }, {}),
      frames: frameStats(frames),
      renders: renderCounts(snapshot),
      dragOver: snapshot?.dragOver ?? null,
      dropTarget: snapshot?.dropTarget ?? null,
      samples: snapshot?.samples ?? null,
      storePublishes: snapshot?.counters?.['store:publish'] ?? 0,
    });

    // --- phase 4: scaled tree (optional) -----------------------------------
    // The frozen QA fixture exposes ~25 root sessions. Real profiles carry
    // hundreds of rows, and a full-tree rerender per dragover scales with that
    // row count. This phase adds empty groups through the public commit route
    // (same document, no other writes) so the same hover shape can be measured
    // on a larger tree.
    let stressPhase = null;
    if (args.stressGroups > 0) {
      const added = await evaluate(`(async () => {
        const load = await fetch('dsh-session-groups/load', { credentials: 'same-origin' }).then((response) => response.json());
        if (!load?.ok) return { error: 'load failed' };
        const doc = { version: 1, groups: [...load.doc.groups], ungrouped: [...load.doc.ungrouped] };
        const seed = Date.now().toString(16).slice(-4);
        for (let index = 0; index < ${Number(args.stressGroups)}; index += 1) {
          const suffix = (seed + index.toString(16).padStart(8, '0')).slice(-12);
          doc.groups.push({ id: 'g-' + suffix, name: 'Stress-' + String(index).padStart(3, '0'), icon: 'folder', parentId: null, sessionIds: [] });
        }
        const response = await fetch('dsh-session-groups/commit', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ baseRevision: load.revision, doc }),
        }).then((res) => res.json());
        return response?.ok ? { ok: true, groups: doc.groups.length, revision: response.revision } : { error: response?.code ?? 'commit failed' };
      })()`, { awaitPromise: true });
      if (!added?.ok) throw new Error(`stress groups failed: ${JSON.stringify(added)}`);
      await driver.navigate(web.url);
      await boot();
      await enterGroups();
      const stressRows = await evaluate(`({
        sessions: document.querySelectorAll('[data-testid="session-groups-session"]').length,
        groups: document.querySelectorAll('[data-testid="session-groups-group"]').length,
      })`);

      await resetProbe();
      await startFrameProbe();
      const stressHoldSetup = await evaluate(`(() => {
        const group = document.querySelector('[data-testid="session-groups-group"]');
        const source = document.querySelectorAll('[data-testid="session-groups-session"]')[0];
        if (!group || !source) return { error: 'stress hold needs a group and a session' };
        window.__dsgStressDrag = { group, source, dt: new DataTransfer() };
        source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dsgStressDrag.dt }));
        return { ok: true };
      })()`);
      if (stressHoldSetup.error) throw new Error(`stress phase: ${stressHoldSetup.error}`);
      const stressHold = [];
      for (let index = 0; index < args.holdEvents; index += 1) {
        const result = await evaluate(`(() => {
          const ctx = window.__dsgStressDrag;
          const rect = ctx.group.getBoundingClientRect();
          const started = performance.now();
          ctx.group.dispatchEvent(new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer: ctx.dt,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
          }));
          return { ms: Math.round((performance.now() - started) * 100) / 100 };
        })()`);
        stressHold.push(result);
        await sleep(16);
      }
      await evaluate(`(() => {
        const ctx = window.__dsgStressDrag;
        ctx.source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: ctx.dt }));
        delete window.__dsgStressDrag;
        return true;
      })()`);
      await sleep(300);
      const stressHoldFrames = await stopFrameProbe();
      const stressHoldSnapshot = await evaluate(`globalThis.__dsgPerfApi.snapshot()`);
      stressPhase = {
        addedGroups: added.groups,
        revision: added.revision,
        rows: stressRows,
        hold: summarizePhase({ events: stressHold.map((entry) => ({ label: 'stress-hold', ms: entry.ms })) }, stressHoldSnapshot, stressHoldFrames),
      };
    }

    const timelineFrom = (marks) => {      const drops = marks.filter((mark) => mark.name === 'drop:event');
      const lastDrop = drops[drops.length - 1];
      if (!lastDrop) return null;
      const after = marks.filter((mark) => mark.t >= lastDrop.t);
      const pick = (name) => after.find((mark) => mark.name === name) ?? null;
      const commitStart = pick('commitDoc:start');
      const apiStart = pick('api:commit:start');
      const httpStart = after.find((mark) => mark.name === 'http:start' && mark.detail?.path?.includes('commit')) ?? null;
      const httpEnd = after.find((mark) => mark.name === 'http:end' && mark.detail?.path?.includes('commit')) ?? null;
      const storeDoc = pick('store:doc');
      const afterDoc = pick('frame:after-doc');
      const delta = (mark) => (mark ? Math.round((mark.t - lastDrop.t) * 100) / 100 : null);
      return {
        dropAt: lastDrop.t,
        commitStartAfterMs: delta(commitStart),
        apiStartAfterMs: delta(apiStart),
        httpStartAfterMs: delta(httpStart),
        httpEndAfterMs: delta(httpEnd),
        httpMs: httpStart && httpEnd ? Math.round((httpEnd.t - httpStart.t) * 100) / 100 : null,
        storeDocAfterMs: delta(storeDoc),
        nextFrameAfterMs: delta(afterDoc),
        savingTrueAfterMs: delta(pick('saving:true')),
        savingFalseAfterMs: delta(pick('saving:false')),
        marksAfterDrop: after.slice(0, 30).map((mark) => ({ t: Math.round((mark.t - lastDrop.t) * 100) / 100, name: mark.name, detail: mark.detail })),
      };
    };

    evidence.phases = {
      hoverBurst: summarizePhase(hover, hoverSnapshot, hoverFrames),
      hoverPaced: summarizePhase({ events: paced.map((entry) => ({ label: 'paced', ms: entry.ms })) }, pacedSnapshot, pacedFrames),
      hoverHold: summarizePhase({ events: hold.map((entry) => ({ label: 'hold', ms: entry.ms })) }, holdSnapshot, holdFrames),
      drops: {
        count: dropResults.length,
        commitMs: stats(dropResults.map((entry) => entry.commitMs)),
        results: dropResults,
        renderCounts: renderCounts(dropSnapshot),
        storePublishes: dropSnapshot?.counters?.['store:publish'] ?? 0,
        timeline: timelineFrom(dropSnapshot?.marks ?? []),
        marks: (dropSnapshot?.marks ?? []).slice(-120),
      },
      stress: stressPhase,
    };
    evidence.consoleErrors = (driver.consoleEntries ?? []).filter((entry) => entry.type === 'error').slice(0, 20);
    evidence.pageErrors = (driver.pageErrors ?? []).slice(0, 20);
    evidence.result = 'PASS';

    mkdirSync(dirname(resolve(args.out)), { recursive: true });
    writeFileSync(resolve(args.out), JSON.stringify(evidence, null, 2), 'utf8');

    const hoverMs = evidence.phases.hoverBurst.eventMs;
    const drops = evidence.phases.drops;
    console.log(`[probe:${args.label}] PASS`);
    console.log(`  sessions=${state.sessions} groups=${Array.isArray(state.groups) ? state.groups.length : 0}`);
    console.log(`  hover: ${hoverMs.count} dragover events, avg ${hoverMs.avg}ms p95 ${hoverMs.p95}ms max ${hoverMs.max}ms; groupsView renders ${evidence.phases.hoverBurst.renders.GroupsView ?? 0}; dropTarget calls/changes ${evidence.phases.hoverBurst.dropTarget?.calls}/${evidence.phases.hoverBurst.dropTarget?.changes}; frame p95 ${evidence.phases.hoverBurst.frames.intervalMs.p95}ms`);
    console.log(`  paced: avg ${evidence.phases.hoverPaced.eventMs.avg}ms; frame avg/p95 ${evidence.phases.hoverPaced.frames.intervalMs.avg}/${evidence.phases.hoverPaced.frames.intervalMs.p95}ms; renders ${evidence.phases.hoverPaced.renders.GroupsView ?? 0}`);
    console.log(`  hold: ${evidence.phases.hoverHold.eventMs.count} events, avg ${evidence.phases.hoverHold.eventMs.avg}ms; renders ${evidence.phases.hoverHold.renders.GroupsView ?? 0}; dropTarget calls/changes ${evidence.phases.hoverHold.dropTarget?.calls}/${evidence.phases.hoverHold.dropTarget?.changes}; frame avg/max ${evidence.phases.hoverHold.frames.intervalMs.avg}/${evidence.phases.hoverHold.frames.intervalMs.max}ms`);
    if (stressPhase) {
      const stressHold = stressPhase.hold;
      console.log(`  stress(${stressPhase.addedGroups} groups + ${stressPhase.rows.sessions} sessions): hold renders ${stressHold.renders.GroupsView ?? 0}; per-event commit ${stressHold.samples?.dragOverMs?.avg}ms handler / frame avg ${stressHold.frames.intervalMs.avg}ms max ${stressHold.frames.intervalMs.max}ms`);
    }
    console.log(`  drops: ${drops.count} commits, commit wall avg ${drops.commitMs.avg}ms p95 ${drops.commitMs.p95}ms max ${drops.commitMs.max}ms`);
    console.log(`  last drop timeline: ${JSON.stringify(drops.timeline && { dropToCommitStart: drops.timeline.commitStartAfterMs, http: drops.timeline.httpMs, dropToStoreDoc: drops.timeline.storeDocAfterMs, dropToNextFrame: drops.timeline.nextFrameAfterMs, savingTrue: drops.timeline.savingTrueAfterMs, savingFalse: drops.timeline.savingFalseAfterMs })}`);
    console.log(`  evidence: ${resolve(args.out)}`);
  } finally {
    try { driver?.cleanup(); } catch { /* noop */ }
  }
  if (evidence.result !== 'PASS') process.exitCode = 1;
}

main().then(() => { process.exitCode = process.exitCode ?? 0; }).catch((error) => {
  console.error(`PROBE ERROR: ${error?.stack ?? error}`);
  process.exitCode = 2;
});
