/**
 * Managed installation of the plugin's session-grove-control skill.
 *
 * DSH discovers skills from <DSH_HOME>/skills. The plugin package contains the
 * source skill; this adapter copies it there on opt-in and can repair it from
 * the plugin settings page without reinstalling the whole plugin.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SKILL_NAME = 'session-grove-control'
export const SKILL_MARKER = '<!-- managed-by: dsh-session-grove -->'
export const SKILL_SOURCE_PATH = fileURLToPath(
  new URL('../../skills/session-grove-control/SKILL.md', import.meta.url),
)

export const skillTargetPath = (dshHome) => join(dshHome, 'skills', SKILL_NAME, 'SKILL.md')

const hash = (text) => createHash('sha256').update(text).digest('hex')

const readSource = () => readFileSync(SKILL_SOURCE_PATH, 'utf8')

/**
 * Verify or install the managed skill.
 * - missing target: install
 * - target managed by us: update when forced, otherwise verify
 * - target user-owned: never overwrite automatically
 *
 * @param {{dshHome: string, force?: boolean}} options
 */
export const repairManagedSkill = ({ dshHome, force = false }) => {
  const source = readSource()
  const target = skillTargetPath(dshHome)
  const digest = hash(source)
  if (existsSync(target)) {
    const current = readFileSync(target, 'utf8')
    if (!current.includes(SKILL_MARKER) && !force) {
      return { ok: true, status: 'skipped-user-owned', path: target, sha256: digest }
    }
    if (current === source) {
      return { ok: true, status: 'verified', path: target, sha256: digest }
    }
    writeFileSync(target, source, 'utf8')
    return { ok: true, status: 'repaired', path: target, sha256: digest }
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, source, 'utf8')
  return { ok: true, status: 'installed', path: target, sha256: digest }
}

/**
 * Remove only a skill file this plugin still owns. A user-edited file without
 * our marker is left untouched.
 */
export const removeManagedSkill = (dshHome) => {
  const target = skillTargetPath(dshHome)
  if (!existsSync(target)) return false
  const current = readFileSync(target, 'utf8')
  if (!current.includes(SKILL_MARKER)) return false
  unlinkSync(target)
  try {
    rmdirSync(dirname(target))
  } catch {
    /* keep a user directory with unrelated files */
  }
  return true
}
