import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshHomePath, resolveRecordPath, resolveStorageDir } from '../../src/host/home.js'
import { makeContext } from './helpers.js'

test('resolveStorageDir prefers the host dshHomePath helper (installed peer)', () => {
  const { ctx } = makeContext()
  const result = resolveStorageDir(ctx)
  assert.equal(result.source, 'dshHomePath("storages")')
  assert.equal(result.dir, dshHomePath('storages'))
  assert.equal(result.dir.endsWith(join('', 'storages')), true)
})

test('resolveStorageDir accepts an injected helper (test seam)', () => {
  const { ctx } = makeContext()
  const result = resolveStorageDir(ctx, {
    homePathModule: { dshHomePath: (...segments) => join('X:\\harness-home', ...segments) },
  })
  assert.deepEqual(result, { dir: join('X:\\harness-home', 'storages'), source: 'dshHomePath("storages")' })
})

test('resolveStorageDir falls back to profileContext.home when the helper is unavailable', () => {
  const ctx = { get: (name) => (name === 'profileContext' ? { home: 'X:\\profile-home' } : undefined) }
  const result = resolveStorageDir(ctx, { homePathModule: null })
  assert.deepEqual(result, { dir: join('X:\\profile-home', 'storages'), source: 'profileContext.home' })
})

test('resolveStorageDir falls back to $DSH_HOME and then ~/.dsh', () => {
  const saved = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = 'X:\\env-home'
    const { ctx } = makeContext()
    assert.deepEqual(resolveStorageDir(ctx, { homePathModule: null }), {
      dir: join('X:\\env-home', 'storages'),
      source: 'DSH_HOME',
    })

    process.env.DSH_HOME = ''
    assert.deepEqual(resolveStorageDir(ctx, { homePathModule: null }), {
      dir: join(homedir(), '.dsh', 'storages'),
      source: 'homedir()/.dsh',
    })
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
  }
})

test('a crashing helper falls through and config.storageDir wins over everything', () => {
  const crashed = resolveStorageDir(
    { get: (name) => (name === 'profileContext' ? { home: 'X:\\profile-home' } : undefined) },
    {
      homePathModule: {
        dshHomePath() {
          throw new Error('no env')
        },
      },
    },
  )
  assert.equal(crashed.source, 'profileContext.home')

  const explicit = resolveStorageDir(
    { get: () => undefined },
    { storageDir: 'X:\\explicit', homePathModule: { dshHomePath: () => 'nope' } },
  )
  assert.deepEqual(explicit, { dir: 'X:\\explicit', source: 'config.storageDir' })
})

test('resolveRecordPath joins the frozen record file name and keeps an explicit path', () => {
  const { ctx } = makeContext()
  const resolved = resolveRecordPath(ctx, {
    homePathModule: { dshHomePath: () => join('X:\\home', 'storages') },
  })
  assert.equal(resolved.filePath, join('X:\\home', 'storages', 'dsh-session-grove.json'))
  assert.equal(resolved.storageSource, 'dshHomePath("storages")')

  const explicit = resolveRecordPath(ctx, {
    filePath: 'X:\\explicit\\record.json',
    homePathModule: null,
  })
  assert.equal(explicit.filePath, 'X:\\explicit\\record.json')
})

test('dshHomePath is re-exported and honours $DSH_HOME (no hard-coded real home)', () => {
  assert.equal(typeof dshHomePath, 'function')
  const saved = process.env.DSH_HOME
  const fakeHome = process.platform === 'win32'
    ? join('X:\\fake-homes', 'host')
    : join(tmpdir(), 'dsg-fake-home')
  try {
    process.env.DSH_HOME = fakeHome
    assert.equal(dshHomePath('storages'), join(fakeHome, 'storages'))
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
  }
})

test('home.js never string-matches the literal developer home path', async () => {
  const source = await readFile(fileURLToPath(new URL('../../src/host/home.js', import.meta.url)), 'utf8')
  assert.equal(/C:\\\\Users\\\\Momiji|C:\/Users\/Momiji/.test(source), false)
})
