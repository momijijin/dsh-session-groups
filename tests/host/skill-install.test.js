import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SKILL_REPAIR_PATH } from '../../src/host/constants.js'
import { removeManagedSkill, repairManagedSkill, SKILL_MARKER, skillTargetPath } from '../../src/host/skill-install.js'
import { makeRequest, mountRoutes } from './helpers.js'

const tempHome = () => mkdtempSync(join(tmpdir(), 'dsg-skill-'))
const cookie = { cookie: 'token=ok' }

test('managed skill can be installed, verified, repaired and removed', () => {
  const home = tempHome()
  const first = repairManagedSkill({ dshHome: home })
  assert.equal(first.status, 'installed')
  assert.equal(readFileSync(skillTargetPath(home), 'utf8').includes(SKILL_MARKER), true)

  assert.equal(repairManagedSkill({ dshHome: home }).status, 'verified')
  writeFileSync(skillTargetPath(home), `${SKILL_MARKER}\nbroken`)
  assert.equal(repairManagedSkill({ dshHome: home }).status, 'repaired')
  assert.equal(removeManagedSkill(home), true)
  assert.equal(removeManagedSkill(home), false)
})

test('user-owned skill is not overwritten unless force is requested', () => {
  const home = tempHome()
  const target = skillTargetPath(home)
  const path = join(home, 'skills', 'session-groups-control')
  mkdirSync(path, { recursive: true })
  writeFileSync(target, '---\nname: session-groups-control\ndescription: custom\n---\n')
  assert.equal(repairManagedSkill({ dshHome: home }).status, 'skipped-user-owned')
  assert.equal(removeManagedSkill(home), false)
  assert.equal(repairManagedSkill({ dshHome: home, force: true }).status, 'repaired')
})

test('repair route is fenced and requires controlApi', async (t) => {
  const home = tempHome()
  const enabled = await mountRoutes({
    connection: {
      requestRejection: (request) => (request.headers.cookie === 'token=ok' ? undefined : 401),
    },
    controlApiEnabled: true,
    skillDshHome: home,
  })
  t.after(() => enabled.cleanup())
  const repaired = await enabled.call(SKILL_REPAIR_PATH, makeRequest({ method: 'POST', headers: cookie }))
  assert.equal(repaired.res.statusCode, 200)
  assert.equal(repaired.json.status, 'installed')

  const disabled = await mountRoutes({
    connection: {
      requestRejection: (request) => (request.headers.cookie === 'token=ok' ? undefined : 401),
    },
    controlApiEnabled: false,
    skillDshHome: tempHome(),
  })
  t.after(() => disabled.cleanup())
  const blocked = await disabled.call(SKILL_REPAIR_PATH, makeRequest({ method: 'POST', headers: cookie }))
  assert.equal(blocked.res.statusCode, 409)
  assert.equal(blocked.json.code, 'control-api-disabled')
})
