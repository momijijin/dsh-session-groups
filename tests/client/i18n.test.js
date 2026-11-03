import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { en, zh } from '../../src/client/locale.js'

const root = new URL('../..', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (match) => match.slice(1))
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  )

const literalKeys = () => {
  const keys = new Set()
  for (const file of walk(join(root, 'src', 'client')).filter((path) => path.endsWith('.js'))) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/\bt\(\s*(['"])([^'"]+)\1/g)) keys.add(match[2])
  }
  return [...keys].sort()
}

test('Chinese and English dictionaries have identical key sets', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
})

test('every literal client translation key exists in both dictionaries', () => {
  const missingZh = literalKeys().filter((key) => !(key in zh))
  const missingEn = literalKeys().filter((key) => !(key in en))
  assert.deepEqual(missingZh, [])
  assert.deepEqual(missingEn, [])
})

test('dynamic keys used by status, archive, settings and errors are present', () => {
  const dynamic = [
    'archive.hidden',
    'archive.all',
    'archive.only',
    'status.idle',
    'status.running',
    'status.completed',
    'status.waitingApproval',
    'status.planReview',
    'status.waitingAnswer',
    'status.compact.approval',
    'status.compact.planReview',
    'status.compact.answer',
    'status.subagentsRunning.one',
    'status.subagentsRunning.other',
    'iconGroup.status',
    'iconGroup.work',
    'iconGroup.devices',
    'iconGroup.actions',
    'iconGroup.life',
    'iconGroup.general',
    'time.justNow',
    'time.minutes',
    'time.hours',
    'time.days',
    'time.years',
    'banner.registration-failed',
    'banner.loadFailed',
    'banner.routeUnavailable',
    'session.archived',
    'config.title',
    'config.hint',
    'config.details.diagnostics',
    'config.details.debugProbe',
    'config.details.controlApi',
    'config.details.controlDestructive',
    'config.details.controlSessions',
    'skill.repairTitle',
    'skill.repairBody',
    'skill.repairButton',
    'skill.repairRunning',
    'skill.repairOk',
    'skill.repairFailed',
  ]
  for (const key of dynamic) {
    assert.equal(typeof zh[key], 'string', `zh missing ${key}`)
    assert.equal(typeof en[key], 'string', `en missing ${key}`)
  }
})

test('plugin manifest exposes localized title and description', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'dsh.plugin.json'), 'utf8'))
  assert.equal(typeof manifest.title?.zh, 'string')
  assert.equal(typeof manifest.title?.en, 'string')
  assert.equal(typeof manifest.description?.zh, 'string')
  assert.equal(typeof manifest.description?.en, 'string')
})
