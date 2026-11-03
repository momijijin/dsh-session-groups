import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const script = fileURLToPath(new URL('../../scripts/session-groups-control.mjs', import.meta.url))

const startServer = async (reply, { authToken = null } = {}) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (authToken !== null && url.pathname === '/' && url.searchParams.get('token') === authToken) {
      res.writeHead(303, { location: './', 'set-cookie': 'dsh_session=ok; Path=/' })
      res.end()
      return
    }
    if (authToken !== null && req.headers.cookie !== 'dsh_session=ok') {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('dsh web authentication required; reopen the URL printed by dsh web.\n')
      return
    }
    res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(reply.body))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, port: server.address().port }
}

const runCli = (args, env) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })

test('control CLI doctor exchanges the web launch token and fetches the read-only report', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsg-cli-'))
  await mkdir(join(home, 'storages'), { recursive: true })
  await writeFile(join(home, 'storages', 'dsh-session-groups.control-token'), 'test-token\n', 'utf8')
  const report = { ok: true, protocol: 1, plugin: { version: 'test' }, gates: { controlApi: true } }
  const { server, port } = await startServer({ body: report }, { authToken: 'web-token' })
  try {
    const result = await runCli(['doctor'], {
      ...process.env,
      DSH_HOME: home,
      DSH_WEB_URL: `http://127.0.0.1:${port}/?token=web-token`,
      DSH_CONTROL_TOKEN: '',
      DSH_WEB_COOKIE: '',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), report)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('control CLI doctor exits non-zero and preserves the server error payload', async () => {
  const { server, port } = await startServer({ status: 403, body: { ok: false, code: 'forbidden' } })
  try {
    const result = await runCli(['doctor'], {
      ...process.env,
      DSH_HOME: await mkdtemp(join(tmpdir(), 'dsg-cli-')),
      DSH_WEB_URL: `http://127.0.0.1:${port}`,
      DSH_CONTROL_TOKEN: 'test-token',
    })
    assert.equal(result.status, 1)
    assert.deepEqual(JSON.parse(result.stdout), { ok: false, code: 'forbidden' })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('control CLI doctor exits non-zero when host compatibility is unsupported', async () => {
  const report = {
    ok: true,
    protocol: 1,
    host: { compatibility: { supported: false, missing: ['webServerRegister'] } },
  }
  const { server, port } = await startServer({ body: report })
  try {
    const result = await runCli(['doctor'], {
      ...process.env,
      DSH_HOME: await mkdtemp(join(tmpdir(), 'dsg-cli-')),
      DSH_WEB_URL: `http://127.0.0.1:${port}`,
      DSH_CONTROL_TOKEN: 'test-token',
    })
    assert.equal(result.status, 1)
    assert.deepEqual(JSON.parse(result.stdout), report)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
