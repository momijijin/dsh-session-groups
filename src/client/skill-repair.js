import { createElement, useState } from 'react'
import { clientRuntime } from '../adapters/client-runtime.js'

const h = createElement

const CONFIG_FIELDS = [
  ['diagnostics', 'config.diagnostics', 'config.diagnosticsHint'],
  ['debugProbe', 'config.debugProbe', 'config.debugProbeHint'],
  ['controlApi', 'config.controlApi', 'config.controlApiHint'],
  ['controlDestructive', 'config.controlDestructive', 'config.controlDestructiveHint'],
  ['controlSessions', 'config.controlSessions', 'config.controlSessionsHint'],
]

/**
 * Plugin settings card: the five config switches plus one-click verification /
 * reinstall of the managed session-groups-control skill.
 */
export const SkillRepairCard = ({ form }) => {
  const t = clientRuntime()?.t ?? ((key) => key)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [pending, setPending] = useState({})
  const config = { ...(form?.state?.value ?? {}), ...pending }

  const setField = async (field, value) => {
    if (!form?.mutate) return
    setPending((current) => ({ ...current, [field]: value }))
    try {
      const accepted = await form.mutate([{ op: 'set', path: [field], value }], form.state?.revision)
      if (accepted === false) setPending((current) => ({ ...current, [field]: !value }))
    } catch {
      setPending((current) => ({ ...current, [field]: !value }))
    }
  }

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
    { class: 'dsg-settings-panel', 'data-testid': 'session-groups-settings-panel' },
    form
      ? h(
          'div',
          { class: 'dsg-config-list', 'data-testid': 'session-groups-config-list' },
          h('div', { class: 'dsg-config-title' }, t('config.title')),
          h('div', { class: 'dsg-config-hint' }, t('config.hint')),
          ...CONFIG_FIELDS.map(([field, labelKey, hintKey]) =>
            h(
              'label',
              { class: 'dsg-config-row', key: field, 'data-testid': `session-groups-config-${field}` },
              h('input', {
                type: 'checkbox',
                class: 'dsg-config-checkbox',
                checked: config[field] === true,
                onChange: (event) => setField(field, event.currentTarget.checked),
              }),
              h(
                'span',
                { class: 'dsg-config-copy' },
                h('span', { class: 'dsg-config-label' }, t(labelKey)),
                h('span', { class: 'dsg-config-proof' }, t(hintKey)),
              ),
            ),
          ),
        )
      : null,
    h(
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
    ),
  )
}
