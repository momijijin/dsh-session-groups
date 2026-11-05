import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createStore } from '../../src/host/store.js'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const storeUrl = pathToFileURL(join(repoRoot, 'src/host/store.js')).href
const empty = () => ({ version: 1, revision: 0, groups: [], ungrouped: [] })

const makePath = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsg-lock-'))
  const storages = join(dir, 'storages')
  await mkdir(storages, { recursive: true })
  return join(storages, 'dsh-session-grove.json')
}

const runCommitChild = (filePath) =>
  new Promise((resolve, reject) => {
    const code = `
      import { createStore } from ${JSON.stringify(storeUrl)};
      const store = createStore({ filePath: process.env.DSG_STORE_PATH, lockWaitMs: 5000 });
      const result = await store.commit(0, { version: 1, revision: 0, groups: [], ungrouped: [] });
      console.log(JSON.stringify(result));
    `
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      cwd: repoRoot,
      env: { ...process.env, DSG_STORE_PATH: filePath },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`child exit ${code}: ${stderr}`))
        return
      }
      const line = stdout.trim().split(/\r?\n/).at(-1)
      try {
        resolve(JSON.parse(line))
      } catch {
        reject(new Error(`invalid child output: ${stdout}`))
      }
    })
  })

test('two processes contending on one record serialize; one commits and one sees a conflict', async () => {
  const filePath = await makePath()
  const results = await Promise.all([runCommitChild(filePath), runCommitChild(filePath)])
  const kinds = results.map((result) => result.kind).sort()
  assert.deepEqual(kinds, ['conflict', 'ok'])
  assert.equal(existsSync(`${filePath}.lock`), false)
  const persisted = JSON.parse(await readFile(filePath, 'utf8'))
  assert.equal(persisted.revision, 1)
})

test('a stale lock is reclaimed automatically', async () => {
  const filePath = await makePath()
  const lockPath = `${filePath}.lock`
  await writeFile(lockPath, JSON.stringify({ pid: process.pid, token: 'stale', createdAt: '2000-01-01T00:00:00.000Z' }), 'utf8')
  const old = new Date(Date.now() - 60_000)
  await utimes(lockPath, old, old)
  const store = createStore({ filePath, lockStaleMs: 50, lockWaitMs: 500 })
  const saved = await store.save(empty())
  assert.equal(saved.revision, 1)
  assert.equal(existsSync(lockPath), false)
})

test('a fresh live lock times out with a stable store-busy error', async () => {
  const filePath = await makePath()
  const lockPath = `${filePath}.lock`
  await writeFile(lockPath, JSON.stringify({ pid: process.pid, token: 'live', createdAt: new Date().toISOString() }), 'utf8')
  const store = createStore({ filePath, lockWaitMs: 40, lockRetryMs: 5 })
  await assert.rejects(
    () => store.save(empty()),
    (error) => error?.code === 'store-busy',
  )
  assert.equal(existsSync(lockPath), true)
  await rm(lockPath, { force: true })
})
