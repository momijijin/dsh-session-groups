#!/usr/bin/env node
// scripts/qa/probe-large-list.mjs
//
// Large ungrouped-list probe (0.2.3 virtualization).
//
// Drives the real isolated DSH web UI against the large-list QA fixture
// (`make-large-list-fixture.mjs`: ~1,500 synthetic root ungrouped sessions plus
// two seeded groups). It records what the 0.2.2 DOM-only optimisation could not
// change and what 0.2.3 windowing does change:
//
//   * initial render latency and the number of ungrouped session rows in the DOM,
//   * scroll latency and the DOM row count after scrolling to the middle,
//   * hover feedback latency (real CDP pointer) and drag-over indicator latency,
//   * search reveal for a session rendered at the very end of the logical list,
//   * drag/drop of a visible ungrouped row into the seeded group.
//
// The same script runs against the pre-fix (0.2.2) and fixed (0.2.3) builds on
// the same fixture so the report can compare identical phases.
//
// Usage:
//   node scripts/qa/probe-large-list.mjs --evidence-dir scripts/qa/evidence-perf/large-before \
//        --label before --out scripts/qa/evidence-perf/large-before.json
//
// Exit codes: 0 = probe captured, 1 = phase failed, 2 = harness error.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { launchDriver, sleep } from '../../e2e/cdp.mjs';

const args = {
  evidenceDir: join(process.cwd(), 'scripts', 'qa', 'evidence'),
  out: null,
  label: 'probe',
  browser: 'auto',
  timeoutMs: 90000,
  screenshot: true,
};
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  const next = () => process.argv[++index];
  if (key === '--evidence-dir') args.evidenceDir = next();
  else if (key === '--out') args.out = next();
  else if (key === '--label') args.label = next();
  else if (key === '--browser') args.browser = next();
  else if (key === '--timeout-ms') args.timeoutMs = Number(next());
  else if (key === '--no-screenshot') args.screenshot = false;
  else throw new Error(`unknown argument: ${key}`);
}

const evidenceDir = resolve(args.evidenceDir);
if (!args.out) args.out = join(evidenceDir, `large-list-${args.label}.json`);
const web = JSON.parse(readFileSync(join(evidenceDir, 'web.json'), 'utf8'));
if (!web?.url) throw new Error(`web.json has no token url under ${evidenceDir}`);
const fixturePath = join(web.spikeHome, 'storages', 'large-list-fixture.json');
const fixture = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null;

const selectors = {
  view: '[data-testid="session-groups-view"]',
  toggle: '[data-testid="session-groups-toggle"]',
  session: '[data-testid="session-groups-session"]',
  group: '[data-testid="session-groups-group"]',
  ungroupedHeader: '[data-testid="session-groups-ungrouped"]',
  searchToggle: '[data-testid="session-groups-search-toggle"]',
  search: '[data-testid="session-groups-search"]',
  searchResults: '[data-testid="session-groups-search-results"]',
  searchResult: '[data-testid="session-groups-search-result"]',
  dropIndicator: '[data-testid="session-groups-drop-indicator"]',
  tree: '.dsg-tree',
};

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

const evidence = {
  kind: 'large-list-probe',
  label: args.label,
  createdAt: new Date().toISOString(),
  qaHome: web.spikeHome,
  port: web.port,
  url: web.baseUrl,
  fixture,
  clientBuild: null,
  phases: {},
  result: 'FAIL',
  consoleErrors: [],
  pageErrors: [],
};

let driver = null;
let originalRecord = null;
const recordPath = join(web.spikeHome, 'storages', 'dsh-session-groups.json');

try {
  originalRecord = readFileSync(recordPath, 'utf8');
} catch {
  originalRecord = null;
}
try {
  evidence.clientBuild = { bytes: readFileSync(join(process.cwd(), 'lib', 'client.js')).length };
} catch {
  /* optional */
}

const evaluate = (expression, options) => driver.evaluate(expression, options);
const waitFor = (expression, description, timeoutMs = args.timeoutMs) => driver.waitFor(expression, { timeoutMs, description });
/**
 * Long-running evaluate for the pre-fix (0.2.2) list: rendering ~1,500 rows can
 * block the renderer well past the driver's default 30 s CDP timeout.
 */
const evaluateLong = async (expression) => {
  const result = await driver.cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    driver.sessionId,
    240000,
  );
  if (result.exceptionDetails) {
    throw new Error(`evaluate failed: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? ''}`);
  }
  return result.result?.value;
};

const dismissOverlay = async () => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const clicked = await evaluate(`(() => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
      for (const dialog of dialogs) {
        const close = dialog.querySelector('button[aria-label="Close"], button[aria-label="关闭"], button[title="Close"], button[title="关闭"]');
        if (close) { close.click(); return 'close'; }
      }
      const byText = Array.from(document.querySelectorAll('button')).find((el) => /^(Continue|继续|知道了|关闭)$/i.test((el.textContent ?? '').trim()));
      if (byText) { byText.click(); return 'text'; }
      if (dialogs.length > 0) {
        dialogs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        return 'escape';
      }
      return false;
    })()`);
    if (!clicked) return true;
    await sleep(350);
  }
  return true;
};

const readDom = () => evaluate(`(() => {
  const rows = Array.from(document.querySelectorAll(${JSON.stringify(selectors.session)}));
  const ungrouped = rows.filter((row) => row.getAttribute('data-ungrouped') === 'true');
  const tree = document.querySelector(${JSON.stringify(selectors.tree)});
  const header = document.querySelector(${JSON.stringify(selectors.ungroupedHeader)});
  const countText = header?.querySelector('.dsg-ungrouped-count')?.textContent ?? '';
  const match = String(countText).match(/\\d+/);
  return {
    ungroupedCount: match ? Number(match[0]) : null,
    domUngroupedRows: ungrouped.length,
    domSessionRows: rows.length,
    domGroupRows: document.querySelectorAll(${JSON.stringify(selectors.group)}).length,
    queueIndicator: document.querySelectorAll(${JSON.stringify(selectors.dropIndicator)}).length,
    treeScrollTop: tree ? tree.scrollTop : null,
    treeScrollHeight: tree ? tree.scrollHeight : null,
    treeClientHeight: tree ? tree.clientHeight : null,
    targetRendered: ${JSON.stringify(fixture?.target ?? null)}
      ? rows.some((row) => row.getAttribute('data-session-id') === ${JSON.stringify(fixture?.target ?? '')})
      : null,
  };
})()`);

try {
  driver = await launchDriver({ browser: args.browser, timeoutMs: args.timeoutMs });
  await driver.navigate(web.url);
  await waitFor(`typeof globalThis.__DSH_BOOT__ !== 'undefined'`, 'app boot payload');
  await waitFor(`!!document.querySelector('#root') && document.querySelector('#root').children.length > 0`, 'React root mounted');
  await dismissOverlay();
  await sleep(700);
  await waitFor(`!!document.querySelector(${JSON.stringify(selectors.toggle)})`, 'footer toggle');
  await dismissOverlay();
  await sleep(500);
  const mode = await evaluate(`document.querySelector(${JSON.stringify(selectors.toggle)})?.getAttribute('data-mode')`);
  if (mode === 'groups') {
    await evaluate(`(() => {
      const workspace = document.querySelector('[data-testid="session-groups-toggle-workspace"]');
      if (workspace) { workspace.click(); return true; }
      document.querySelector(${JSON.stringify(selectors.toggle)}).click();
      return true;
    })()`);
    await waitFor(`!document.querySelector(${JSON.stringify(selectors.view)})`, 'workspace view');
    await sleep(400);
  }

  // (1) Initial groups-view render: click the footer toggle, then wait for the
  // first ungrouped row. This includes React commit + layout of the whole list.
  // 0.2.2 exposes a two-segment wrapper; 0.2.3 is a single button on the wrapper.
  const initial = await evaluateLong(`(async () => {
    const now = () => performance.now();
    const groups = document.querySelector('[data-testid="session-groups-toggle-groups"]');
    const target = groups ?? document.querySelector(${JSON.stringify(selectors.toggle)});
    const t0 = now();
    target.click();
    await new Promise((resolve) => {
      const deadline = now() + 60000;
      const poll = () => {
        const rows = document.querySelectorAll(${JSON.stringify(selectors.view)} + ' ' + ${JSON.stringify(selectors.session)} + '[data-ungrouped="true"]');
        if (rows.length > 0 || now() > deadline) resolve();
        else requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    });
    const tFirst = now();
    await new Promise((resolve) => setTimeout(resolve, 800));
    return { firstRowMs: tFirst - t0, settledMs: now() - t0 };
  })()`);
  await waitFor(`!!document.querySelector(${JSON.stringify(selectors.view)})`, 'groups view mounted');
  await waitFor(`document.querySelectorAll(${JSON.stringify(selectors.session)} + '[data-ungrouped="true"]').length > 0`, 'ungrouped rows', 60000);
  evidence.phases.initial = { ...initial, ...(await readDom()) };

  // (2) Scroll to the middle of the logical list and measure the next two
  // animation frames. A DOM-only list re-lays out all ~1,500 rows here.
  evidence.phases.scroll = await evaluateLong(`(async () => {
    const tree = document.querySelector(${JSON.stringify(selectors.tree)});
    if (!tree) throw new Error('tree missing');
    const before = {
      rows: document.querySelectorAll(${JSON.stringify(selectors.session)} + '[data-ungrouped="true"]').length,
      scrollWidth: tree.scrollWidth,
      clientWidth: tree.clientWidth,
    };
    const t0 = performance.now();
    tree.scrollTop = Math.floor((tree.scrollHeight - tree.clientHeight) * 0.5);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rows = document.querySelectorAll(${JSON.stringify(selectors.session)} + '[data-ungrouped="true"]');
    return {
      ms: performance.now() - t0,
      scrollTop: tree.scrollTop,
      scrollHeight: tree.scrollHeight,
      clientHeight: tree.clientHeight,
      beforeRows: before.rows,
      afterRows: rows.length,
      firstRowId: rows[0]?.getAttribute('data-session-id') ?? null,
      lastRowId: rows[rows.length - 1]?.getAttribute('data-session-id') ?? null,
      horizontalOverflow: tree.scrollWidth > tree.clientWidth + 1,
    };
  })()`);

  // (3) Scroll to the bottom and read the last ungrouped row (the seeded search
  // target is stored last, i.e. logically at the end of ~1,500 rows).
  const bottom = await evaluateLong(`(async () => {
    const tree = document.querySelector(${JSON.stringify(selectors.tree)});
    tree.scrollTop = tree.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rows = Array.from(document.querySelectorAll(${JSON.stringify(selectors.session)} + '[data-ungrouped="true"]'));
    const last = rows[rows.length - 1] ?? null;
    const target = ${JSON.stringify(fixture?.target ?? null)}
      ? document.querySelector(${JSON.stringify(selectors.session)} + '[data-session-id="' + ${JSON.stringify(fixture?.target ?? '')} + '"]')
      : null;
    return {
      scrollTop: tree.scrollTop,
      rows: rows.length,
      lastRow: last ? { sid: last.getAttribute('data-session-id'), title: (last.querySelector('.dsg-session-title')?.textContent ?? '').trim() } : null,
      targetRow: target ? { sid: target.getAttribute('data-session-id'), title: (target.querySelector('.dsg-session-title')?.textContent ?? '').trim() } : null,
    };
  })()`);
  evidence.phases.bottom = bottom;
  const searchTitle = fixture?.title ?? bottom.targetRow?.title ?? bottom.lastRow?.title ?? null;
  if (!searchTitle) throw new Error('could not resolve the seeded search target title');

  // Back to the top for hover/search/drag.
  await evaluate(`document.querySelector(${JSON.stringify(selectors.tree)}).scrollTop = 0`);
  await sleep(250);

  // (4) Hover feedback: move a real pointer over an ungrouped row; if headless
  // hit-testing does not surface :hover, force the pseudo state through CDP and
  // still measure the style/layout response of the current DOM size.
  await dismissOverlay();
  await sleep(500);
  const firstRow = await evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll(${JSON.stringify(selectors.session)} + '[data-ungrouped="true"]'));
    const row = rows.find((item) => item.getAttribute('data-current') !== 'true' && item.getAttribute('data-archived') !== 'true') ?? rows[0];
    if (!row) return null;
    const rect = row.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      before: getComputedStyle(row).backgroundColor,
      sid: row.getAttribute('data-session-id'),
      hitBefore: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.getAttribute?.('data-testid') ?? null,
    };
  })()`);
  if (!firstRow) throw new Error('no ungrouped row for the hover probe');
  await driver.cdp.send('Page.bringToFront', {}, driver.sessionId).catch(() => undefined);
  await driver.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none', buttons: 0, clickCount: 0 }, driver.sessionId);
  await sleep(100);
  await evaluate(`window.__largeHoverStart = performance.now(); window.__largeHoverBefore = ${JSON.stringify(firstRow.before)}; true`);
  await driver.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: firstRow.x, y: firstRow.y, button: 'none', buttons: 0, clickCount: 0 }, driver.sessionId);
  const readHover = () => evaluate(`(async () => {
    const sid = ${JSON.stringify(firstRow.sid)};
    const deadline = performance.now() + 1200;
    let last = null;
    while (performance.now() < deadline) {
      const row = document.querySelector(${JSON.stringify(selectors.session)} + '[data-session-id="' + sid + '"]');
      if (row) {
        const style = getComputedStyle(row);
        const parts = String(style.backgroundColor).match(/rgba?\\(([^)]+)\\)/);
        const alpha = parts ? (parts[1].split(',').length > 3 ? Number.parseFloat(parts[1].split(',')[3]) : 1) : 0;
        last = {
          hovered: row.matches(':hover'),
          background: style.backgroundColor,
          color: style.color,
          alpha,
          hit: document.elementFromPoint(${Number(firstRow.x)}, ${Number(firstRow.y)})?.getAttribute?.('data-testid') ?? null,
        };
        if (alpha > 0 && row.getAttribute('data-current') !== 'true') {
          return { ms: performance.now() - window.__largeHoverStart, before: window.__largeHoverBefore, ...last, via: 'pointer' };
        }
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return { ms: null, before: window.__largeHoverBefore, ...last, via: 'pointer' };
  })()`, { awaitPromise: true });
  let hover = await readHover();
  if (hover?.ms === null) {
    try {
      await driver.cdp.send('DOM.enable', {}, driver.sessionId);
      await driver.cdp.send('CSS.enable', {}, driver.sessionId).catch(() => undefined);
      const { root } = await driver.cdp.send('DOM.getDocument', { depth: 0, pierce: false }, driver.sessionId);
      const { nodeId } = await driver.cdp.send('DOM.querySelector', {
        nodeId: root.nodeId,
        selector: `${selectors.session}[data-session-id="${firstRow.sid}"]`,
      }, driver.sessionId);
      await evaluate(`window.__largeHoverStart = performance.now(); true`);
      await driver.cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] }, driver.sessionId);
      hover = await readHover();
      hover = { ...hover, via: hover?.ms === null ? 'forced-pseudo-failed' : 'forced-pseudo', hitBefore: firstRow.hitBefore };
    } catch (error) {
      hover = { ...hover, via: 'forced-pseudo-error', error: String(error?.message ?? error), hitBefore: firstRow.hitBefore };
    }
  }
  evidence.phases.hover = hover;

  // (5) Drag-over feedback: a synthetic session drag over the ungrouped section
  // must surface the drop indicator quickly (the user can tell a drop will work).
  evidence.phases.dragOver = await evaluate(`(async () => {
    const rows = Array.from(document.querySelectorAll(${JSON.stringify(selectors.session)} + '[data-ungrouped="true"]'));
    const source = rows[0];
    const header = document.querySelector(${JSON.stringify(selectors.ungroupedHeader)});
    if (!source || !header) return { ms: null, reason: 'row/header missing' };
    const dt = new DataTransfer();
    const t0 = performance.now();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const rect = header.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    for (const type of ['dragenter', 'dragover']) header.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    const deadline = performance.now() + 3000;
    let found = false;
    while (performance.now() < deadline) {
      if (header.getAttribute('data-drop-active') === 'true') { found = true; break; }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const ms = found ? performance.now() - t0 : null;
    const kind = header.getAttribute('data-drop-kind');
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    return { ms, found, kind, sourceId: source.getAttribute('data-session-id') };
  })()`, { awaitPromise: true });

  // (6) Drag/drop one visible ungrouped row into the seeded group. This runs
  // before the search reveal because opening the real search target can load a
  // multi-MB transcript and end the CDP session.
  const dropProbe = await evaluate(`(async () => {
    const group = document.querySelector(${JSON.stringify(selectors.group)} + '[data-group-id="g-large-a"]');
    const source = document.querySelector(${JSON.stringify(selectors.session)} + '[data-ungrouped="true"]');
    if (!group || !source) return { ok: false, reason: 'group/source missing' };
    const sid = source.getAttribute('data-session-id');
    const dt = new DataTransfer();
    const rect = group.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + Math.max(2, rect.height * 0.2);
    const t0 = performance.now();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    group.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    group.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline) {
      const moved = document.querySelector(${JSON.stringify(selectors.session)} + '[data-session-id="' + sid + '"][data-group-id="g-large-a"]');
      if (moved) return { ok: true, sid, ms: performance.now() - t0 };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { ok: false, sid, reason: 'row did not appear in the group' };
  })()`, { awaitPromise: true });
  evidence.phases.drop = dropProbe;
  if (!dropProbe.ok) throw new Error(`drag/drop into the seeded group failed: ${dropProbe.reason}`);

  // (7) Search reveal for the seeded row at the logical end of the list. It is
  // outside the rendered window at scrollTop=0; selecting it must force the
  // window forward and scroll the tree to the highlighted row.
  const scrollBeforeSearch = (await readDom()).treeScrollTop;
  await evaluate(`document.querySelector(${JSON.stringify(selectors.searchToggle)}).click()`);
  await waitFor(`!!document.querySelector(${JSON.stringify(selectors.search)})`, 'search input');
  await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selectors.search)});
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(searchTitle)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor(`document.querySelectorAll(${JSON.stringify(selectors.searchResult)}).length > 0`, 'search results');
  const resultIds = await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selectors.searchResult)}), (el) => el.getAttribute('data-session-id'))`);
  if (!fixture?.target || !resultIds.includes(fixture.target)) {
    throw new Error(`search results for ${JSON.stringify(searchTitle)} do not include the seeded target ${fixture?.target} (got ${JSON.stringify(resultIds.slice(0, 20))})`);
  }
  const targetIndex = resultIds.indexOf(fixture.target);
  const searchStart = await evaluate(`window.__largeSearchStart = performance.now(); true`);
  for (let step = 0; step <= targetIndex; step += 1) {
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selectors.search)});
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      return true;
    })()`);
    await sleep(60);
  }
  await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selectors.search)});
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return true;
  })()`);
  evidence.phases.search = await evaluate(`(async () => {
    const sid = ${JSON.stringify(fixture.target)};
    const tree = document.querySelector(${JSON.stringify(selectors.tree)});
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) {
      const row = document.querySelector(${JSON.stringify(selectors.session)} + '[data-session-id="' + sid + '"]');
      if (row && row.classList.contains('dsg-search-hit')) {
        return {
          ms: performance.now() - window.__largeSearchStart,
          scrollTop: tree.scrollTop,
          highlighted: true,
          domUngroupedRows: document.querySelectorAll(${JSON.stringify(selectors.session)} + '[data-ungrouped="true"]').length,
          dropdownClosed: !document.querySelector(${JSON.stringify(selectors.searchResults)}),
        };
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const row = document.querySelector(${JSON.stringify(selectors.session)} + '[data-session-id="' + sid + '"]');
    return {
      ms: null,
      scrollTop: tree.scrollTop,
      highlighted: false,
      rendered: !!row,
      dropdownClosed: !document.querySelector(${JSON.stringify(selectors.searchResults)}),
    };
  })()`, { awaitPromise: true });
  evidence.phases.search.scrollBefore = scrollBeforeSearch;
  if (!evidence.phases.search.highlighted) throw new Error('search reveal did not render/highlight the far ungrouped target');
  if (!evidence.phases.search.dropdownClosed) throw new Error('search dropdown stayed open after selecting the target');
  if (!(evidence.phases.search.scrollTop > 1000)) throw new Error(`tree did not scroll to the far ungrouped target (scrollTop=${evidence.phases.search.scrollTop})`);
  void searchStart;

  await sleep(500);
  evidence.result = 'PASS';
} catch (error) {
  evidence.error = String(error?.stack ?? error?.message ?? error);
  evidence.result = 'FAIL';
} finally {
  evidence.consoleErrors = (driver?.consoleEntries ?? []).filter((entry) => entry.type === 'error').slice(0, 30);
  evidence.pageErrors = (driver?.pageErrors ?? []).slice(0, 30);
  if (args.screenshot && driver) {
    try {
      const shotDir = join(evidenceDir, 'screenshots');
      await driver.screenshot(join(shotDir, `large-list-${args.label}.png`));
      evidence.screenshot = join(shotDir, `large-list-${args.label}.png`);
    } catch {
      /* screenshots are best effort */
    }
  }
  // The probe's drag/drop mutates the disposable group record; restore it so the
  // same fixture can be probed again with the other build.
  if (originalRecord !== null) {
    try {
      await sleep(300);
      writeFileSync(recordPath, originalRecord, 'utf8');
      evidence.recordRestored = true;
    } catch (error) {
      evidence.recordRestored = false;
      evidence.recordRestoreError = String(error?.message ?? error);
    }
  }
  writeFileSync(args.out, JSON.stringify(evidence, null, 2), 'utf8');
  console.log(`large-list probe ${evidence.result}: ${args.out}`);
  console.log(`  initial: ${JSON.stringify(evidence.phases.initial)}`);
  console.log(`  scroll: ${JSON.stringify(evidence.phases.scroll)}`);
  console.log(`  hover: ${JSON.stringify(evidence.phases.hover)}`);
  console.log(`  dragOver: ${JSON.stringify(evidence.phases.dragOver)}`);
  console.log(`  search: ${JSON.stringify(evidence.phases.search)}`);
  console.log(`  drop: ${JSON.stringify(evidence.phases.drop)}`);
  try { driver?.cleanup(); } catch { /* noop */ }
}

process.exitCode = evidence.result === 'PASS' ? 0 : 1;
void stats;
