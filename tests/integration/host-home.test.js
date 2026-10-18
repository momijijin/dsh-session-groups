// tests/integration/host-home.test.js
//
// V1 host integration - `src/host/home.js` must resolve the storages directory
// from `dshHomePath('storages')` (CONTRACTS §2 "File"), with the documented
// fallback chain (profileContext.home -> $DSH_HOME -> ~/.dsh), never a hard-coded
// real home. The test is adaptive: the module's exported helper name is discovered
// at runtime (the contract leaves the internal name to Host), and the test skips
// with a diagnostic if the module is missing or exports an unrecognised surface.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { REPO_ROOT, skipReason } from './helpers.js';

const homeModulePath = join(REPO_ROOT, 'src', 'host', 'home.js');
const skip = existsSync(homeModulePath) ? false : skipReason('src/host/home.js');

async function importHomeModule() {
  return await import(new URL('../../src/host/home.js', import.meta.url).href);
}

function findStoragesResolver(module) {
  const candidates = [
    module.dshHomePath,
    module.storagesDir,
    module.storagesPath,
    module.createHome,
    module.resolveHome,
    module.resolveDshHome,
    module.default?.dshHomePath,
    module.default?.storagesDir,
  ].filter((candidate) => typeof candidate === 'function');
  return candidates[0] ?? null;
}

test('home: storages directory resolves under an injected/legacy home (no hard-coded real home)', { skip }, async (t) => {
  const module = await importHomeModule();
  const resolver = findStoragesResolver(module);
  if (!resolver) {
    t.skip('home.js exports no recognised storages resolver yet (adaptive test)');
    return;
  }

  const previous = process.env.DSH_HOME;
  const fakeHome = join(tmpdir(), `dsh-home-resolve-${process.pid}-${Date.now()}`);
  process.env.DSH_HOME = fakeHome;
  try {
    let resolved;
    try {
      resolved = resolver('storages');
    } catch {
      // Fallback chain may require a profileContext argument first.
      resolved = resolver({ home: fakeHome }, 'storages');
    }
    resolved = String(resolved);
    assert.equal(resolved.startsWith(fakeHome), true, `resolved '${resolved}' must be under $DSH_HOME '${fakeHome}'`);
    assert.equal(resolved.includes(join(fakeHome, 'storages')), true, `expected <home>/storages, got '${resolved}'`);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
  }
});

test('home: module never string-matches the literal real home path', { skip }, async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(homeModulePath, 'utf8'));
  assert.equal(
    /C:\\\\Users\\\\Momiji|C:\/Users\/Momiji/.test(source),
    false,
    'src/host/home.js must not hard-code the developer machine home path',
  );
});
