// e2e/_debug-dom.mjs (temporary QA diagnostic; deleted after fixture investigation)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchDriver, sleep } from './cdp.mjs';

const repo = process.cwd();
const evidence = join(repo, 'scripts', 'qa', 'evidence');
const state = JSON.parse(readFileSync(join(evidence, 'web.json'), 'utf8'));
const driver = await launchDriver({ browser: 'auto' });
try {
  await driver.navigate(state.url);
  await driver.waitFor(`typeof globalThis.__DSH_BOOT__ !== 'undefined'`, { timeoutMs: 30000 });
  await driver.waitFor(`!!document.querySelector('#root') && document.querySelector('#root').children.length > 0`, { timeoutMs: 30000 });
  await driver.evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find((el) => /^(Continue|继续|知道了|关闭)$/i.test((el.textContent ?? '').trim())); if (b) b.click(); return true; })()`);
  await sleep(800);
  const boot = await driver.evaluate(`JSON.stringify(globalThis.__DSH_BOOT__ ?? null).slice(0, 2000)`);
  console.log('BOOT', boot);
  const official = await driver.evaluate(`document.body.innerText.slice(0, 4000)`);
  console.log('OFFICIAL BODY >>>', official);
  const toggle = await driver.evaluate(`(() => { const el = document.querySelector('[data-testid="session-groups-toggle"]'); if (!el) return null; el.click(); return { mode: el.getAttribute('data-mode') }; })()`);
  console.log('TOGGLE', JSON.stringify(toggle));
  await sleep(1200);
  const groups = await driver.evaluate(`(() => {
    const q = (sel) => Array.from(document.querySelectorAll(sel));
    return {
      view: !!document.querySelector('[data-testid="session-groups-view"]'),
      sessionRows: q('[data-testid="session-groups-session"]').map((el) => ({ sid: el.getAttribute('data-session-id'), group: el.getAttribute('data-group-id'), ung: el.getAttribute('data-ungrouped'), text: (el.textContent ?? '').slice(0, 60) })),
      ungroupedHead: !!document.querySelector('[data-testid="session-groups-ungrouped"]'),
      body: document.body.innerText.slice(0, 4000),
    };
  })()`);
  console.log('GROUPS', JSON.stringify(groups, null, 2));
} finally {
  driver.cleanup();
}
