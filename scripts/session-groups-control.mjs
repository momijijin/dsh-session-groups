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
const BASE = process.env.DSH_WEB_URL ?? `http://127.0.0.1:${process.env.DSH_WEB_PORT ?? '43120'}`
const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const TOKEN = process.env.DSH_CONTROL_TOKEN ?? readToken()

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
        'usage: session-groups-control.mjs state | plan <body.json> | apply <body.json>\n' +
        'body.json: { baseRevision, operations, planHash?, idempotencyKey? }',
    },
    2,
  )
}

const command = process.argv[2]
if (!['state', 'plan', 'apply'].includes(command)) usage()

let body
if (command !== 'state') {
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

const path = `/dsh-session-groups/control/${command}`
const response = await fetch(`${BASE}${path}`, {
  method: command === 'state' ? 'GET' : 'POST',
  headers: {
    authorization: `Bearer ${TOKEN}`,
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
print(parsed, response.ok ? 0 : 1)
