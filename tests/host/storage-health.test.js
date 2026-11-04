import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { inspectStorageHealth } from '../../src/host/storage-health.js'
import { sampleDoc } from './helpers.js'

const makePath = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsg-health-'))
  await mkdir(join(dir, 'storages'), { recursive: true })
  return join(dir, 'storages', 'dsh-session-groups.json')
}

test('storage health reports missing, valid, backup and quarantine state read-only', async () => {
  const filePath = await makePath()
  const missing = await inspectStorageHealth(filePath)
  assert.deepEqual(missing, {
    status: 'missing',
    revision: null,
    error: null,
    backup: false,
    backupStatus: 'missing',
    backupRevision: null,
    backupError: null,
    quarantined: 0,
  })

  await writeFile(filePath, JSON.stringify({ ...sampleDoc(), revision: 4 }), 'utf8')
  await writeFile(`${filePath}.bak`, JSON.stringify({ ...sampleDoc(), revision: 3 }), 'utf8')
  await writeFile(join(filePath, '..', 'dsh-session-groups.corrupt-2026.json'), '{}', 'utf8')
  const healthy = await inspectStorageHealth(filePath)
  assert.equal(healthy.status, 'ok')
  assert.equal(healthy.revision, 4)
  assert.equal(healthy.backup, true)
  assert.equal(healthy.backupStatus, 'ok')
  assert.equal(healthy.backupRevision, 3)
  assert.equal(healthy.quarantined, 1)
})

test('storage health distinguishes a corrupt backup from a usable one', async () => {
  const filePath = await makePath()
  await writeFile(filePath, JSON.stringify({ ...sampleDoc(), revision: 4 }), 'utf8')
  await writeFile(`${filePath}.bak`, '{broken', 'utf8')
  const corruptBackup = await inspectStorageHealth(filePath)
  assert.equal(corruptBackup.status, 'ok')
  assert.equal(corruptBackup.backup, true)
  assert.equal(corruptBackup.backupStatus, 'corrupt')
  assert.match(corruptBackup.backupError, /JSON/)

  await writeFile(`${filePath}.bak`, JSON.stringify({ ...sampleDoc(), version: 9 }), 'utf8')
  const unsupportedBackup = await inspectStorageHealth(filePath)
  assert.equal(unsupportedBackup.backupStatus, 'unsupported-version')

  await writeFile(`${filePath}.bak`, JSON.stringify({ version: 0, revision: 1, groups: [], ungrouped: [] }), 'utf8')
  const invalidBackup = await inspectStorageHealth(filePath)
  assert.equal(invalidBackup.backupStatus, 'invalid')
})

test('storage health classifies corrupt, unsupported, invalid and unreadable records without repairing them', async () => {
  const corruptPath = await makePath()
  await writeFile(corruptPath, '{broken', 'utf8')
  const corrupt = await inspectStorageHealth(corruptPath)
  assert.equal(corrupt.status, 'corrupt')
  assert.match(corrupt.error, /JSON/)

  const unsupportedPath = await makePath()
  await writeFile(unsupportedPath, JSON.stringify({ ...sampleDoc(), version: 9, revision: 1 }), 'utf8')
  assert.equal((await inspectStorageHealth(unsupportedPath)).status, 'unsupported-version')

  const invalidPath = await makePath()
  await writeFile(invalidPath, JSON.stringify({ version: 0, revision: 1, groups: [], ungrouped: [] }), 'utf8')
  const invalidVersion = await inspectStorageHealth(invalidPath)
  assert.equal(invalidVersion.status, 'invalid')
  assert.match(invalidVersion.error, /version must be 1/)

  const duplicatePath = await makePath()
  await writeFile(duplicatePath, JSON.stringify({
    version: 1,
    revision: 1,
    groups: [{ id: 'g', name: 'G', icon: 'folder', parentId: null, sessionIds: ['same'] }],
    ungrouped: ['same'],
  }), 'utf8')
  const invalid = await inspectStorageHealth(duplicatePath)
  assert.equal(invalid.status, 'invalid')
  assert.match(invalid.error, /duplicate-session/)

  const unreadablePath = await makePath()
  await mkdir(unreadablePath)
  const unreadable = await inspectStorageHealth(unreadablePath)
  assert.equal(unreadable.status, 'unreadable')
})
