#!/usr/bin/env node
/**
 * Local CLI for the opt-in dsh-session-groups AI control API.
 *
 * It reads the per-run bearer token written under DSH_HOME/storages and talks
 * only to the local DSH web server. It never reads or writes the group JSON
 * directly; every mutation goes through state -> plan -> apply.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const TOKEN_FILE = 'dsh-session-groups.control-token'
const configuredUrl = new URL(process.env.DSH_WEB_URL ?? `http://127.0.0.1:${process.env.DSH_WEB_PORT ?? '43120'}`)
const webToken = configuredUrl.searchParams.get('token')
configuredUrl.searchParams.delete('token')
const BASE = configuredUrl.href.replace(/\/$/, '')
const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const TOKEN = process.env.DSH_CONTROL_TOKEN?.trim() || readToken()

function readToken() {
  try {
    const value = readFileSync(join(HOME, 'storages', TOKEN_FILE), 'utf8').trim()
    return value.length > 0 ? value : null
  } catch {
    return null
  }
}

const print = (value, status = 0) => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  process.exitCode = status
}

const die = (value, status = 1) => {
  print(value, status)
  process.exit(status)
}

const usage = () => {
  die(
    {
      ok: false,
      code: 'usage',
      message:
        'usage: session-groups-control.mjs state | doctor | resolve <body.json> | plan <body.json> | apply <body.json>\n' +
        '       | session-inspect <body.json> | session-rename <body.json> | session-archive <body.json>\n' +
        'body.json: { path?, baseRevision, operations?, planHash?, idempotencyKey?, sessionId?, title?, archived? }',
    },
    2,
  )
}

const command = process.argv[2]
const commands = ['state', 'doctor', 'resolve', 'plan', 'apply', 'session-inspect', 'session-rename', 'session-archive']
if (!commands.includes(command)) usage()

let body
if (command !== 'state' && command !== 'doctor') {
  const file = process.argv[3]
  if (!file) usage()
  try {
    body = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    die({ ok: false, code: 'body-read-failed', message: error instanceof Error ? error.message : String(error) }, 2)
  }
}

if (!TOKEN) {
  die(
    {
      ok: false,
      code: 'control-token-missing',
      message: 'controlApi is off or the plugin has not written its local control token',
    },
    1,
  )
}

const controlPath = command.startsWith('session-') ? command.slice(8) : command
const path = `/dsh-session-groups/control/${command.startsWith('session-') ? `session/${controlPath}` : controlPath}`

const webCookie = async () => {
  const supplied = process.env.DSH_WEB_COOKIE?.trim()
  if (supplied) return supplied
  if (!webToken) return null
  const root = new URL('/', configuredUrl)
  root.searchParams.set('token', webToken)
  const response = await fetch(root.href, { redirect: 'manual', headers: { accept: 'text/html' } }).catch((error) => {
    die({ ok: false, code: 'web-auth-failed', message: error instanceof Error ? error.message : String(error) }, 1)
  })
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
  const cookie = setCookies[0]?.split(';')[0]?.trim()
  if (!cookie) {
    die(
      {
        ok: false,
        code: 'web-auth-required',
        message: 'DSH web authentication rejected the launch token; reopen the URL printed by dsh web.',
      },
      1,
    )
  }
  return cookie
}

const cookie = await webCookie()
const response = await fetch(`${BASE}${path}`, {
  method: command === 'state' || command === 'doctor' ? 'GET' : 'POST',
  headers: {
    authorization: `Bearer ${TOKEN}`,
    ...(cookie === null ? {} : { cookie }),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  },
  body: body === undefined ? undefined : JSON.stringify(body),
}).catch((error) => {
  die({ ok: false, code: 'request-failed', message: error instanceof Error ? error.message : String(error) }, 1)
})

const text = await response.text()
let parsed
try {
  parsed = JSON.parse(text)
} catch {
  parsed = { ok: false, code: 'invalid-response', message: text.slice(0, 500) }
}
const compatibilityFailed = command === 'doctor' && parsed?.host?.compatibility?.supported === false
print(parsed, response.ok && !compatibilityFailed ? 0 : 1)
