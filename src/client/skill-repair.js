import { createElement, useState } from 'react'
import { clientRuntime } from '../adapters/client-runtime.js'

const h = createElement

/**
 * Plugin settings card: one-click verify/reinstall of the managed
 * session-groups-control skill. The host route is fenced; controlApi must be on.
 */
export const SkillRepairCard = () => {
  const t = clientRuntime()?.t ?? ((key) => key)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const repair = async () => {
    if (busy) return
    setBusy(true)
    setResult(null)
    try {
      const response = await fetch('/dsh-session-groups/skill/repair', {
        method: 'POST',
        credentials: 'same-origin',
      })
      const json = await response.json().catch(() => ({}))
      setResult({ ok: response.ok && json.ok !== false, code: json.code ?? null, status: json.status ?? null })
    } catch (error) {
      setResult({ ok: false, code: 'network', status: null, detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  return h(
    'div',
    { class: 'dsg-skill-repair', 'data-testid': 'session-groups-skill-repair' },
    h(
      'div',
      { class: 'dsg-skill-repair-copy' },
      h('div', { class: 'dsg-skill-repair-title' }, t('skill.repairTitle')),
      h('div', { class: 'dsg-skill-repair-body' }, t('skill.repairBody')),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'dsg-skill-repair-button',
        'data-testid': 'session-groups-skill-repair-button',
        disabled: busy,
        onClick: repair,
      },
      busy ? t('skill.repairRunning') : t('skill.repairButton'),
    ),
    result
      ? h(
          'div',
          {
            class: 'dsg-skill-repair-result',
            'data-ok': result.ok ? 'true' : 'false',
            'data-testid': 'session-groups-skill-repair-result',
          },
          result.ok ? t('skill.repairOk') : t('skill.repairFailed'),
          result.code ? ` (${result.code})` : '',
        )
      : null,
  )
}
