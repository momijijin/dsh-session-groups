import { createElement, useEffect, useState } from 'react'
import {
  Button,
  IconInfoOutlineRegular,
  Switch,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { clientRuntime } from '../adapters/client-runtime.js'

const h = createElement

const CONFIG_FIELDS = [
  ['diagnostics', 'config.diagnostics', 'config.diagnosticsHint', 'config.details.diagnostics'],
  ['debugProbe', 'config.debugProbe', 'config.debugProbeHint', 'config.details.debugProbe'],
  ['controlApi', 'config.controlApi', 'config.controlApiHint', 'config.details.controlApi'],
  ['controlDestructive', 'config.controlDestructive', 'config.controlDestructiveHint', 'config.details.controlDestructive'],
  ['controlSessions', 'config.controlSessions', 'config.controlSessionsHint', 'config.details.controlSessions'],
]

const readFormValue = (form) => {
  try {
    return form?.getSnapshot?.()?.value ?? form?.state?.value ?? {}
  } catch {
    return {}
  }
}

/**
 * Plugin settings card: standard DSH switches with per-option details plus the
 * managed skill repair action.
 */
export const SkillRepairCard = ({ form }) => {
  const t = clientRuntime()?.t ?? ((key) => key)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [pending, setPending] = useState({})
  const [destructivePrompt, setDestructivePrompt] = useState(false)
  const [formValue, setFormValue] = useState(() => readFormValue(form))

  useEffect(() => {
    if (form === undefined || form === null) {
      setFormValue({})
      return undefined
    }
    setFormValue(readFormValue(form))
    if (typeof form.subscribe !== 'function') return undefined
    return form.subscribe(() => setFormValue(readFormValue(form)))
  }, [form])

  const config = { ...formValue, ...pending }

  const setField = async (field, value) => {
    if (form === undefined || form === null) return
    setPending((current) => ({ ...current, [field]: value }))
    try {
      let accepted
      if (typeof form.set === 'function') accepted = await form.set(field, value)
      else if (typeof form.mutate === 'function') {
        const revision = form.state?.revision ?? form.getSnapshot?.()?.revision
        accepted = await form.mutate([{ op: 'set', path: [field], value }], revision)
      } else accepted = false
      if (accepted === false) setPending((current) => ({ ...current, [field]: !value }))
      else clientRuntime()?.refreshRuntimeConfig?.()
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

  const requestFieldChange = (field, next) => {
    if (field === 'controlDestructive' && next === true && config.controlDestructive !== true) {
      setDestructivePrompt(true)
      return
    }
    if (field === 'controlDestructive') setDestructivePrompt(false)
    void setField(field, next)
  }

  const confirmDestructive = () => {
    setDestructivePrompt(false)
    void setField('controlDestructive', true)
  }

  const renderConfirm = (field) => {
    if (field !== 'controlDestructive' || !destructivePrompt) return null
    return h(
      'div',
      {
        class: 'dsg-config-confirm',
        role: 'alert',
        'data-testid': 'session-groups-config-destructive-confirm',
        onKeyDown: (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            setDestructivePrompt(false)
          }
        },
      },
      h('div', { class: 'dsg-config-confirm-body' }, t('config.destructiveConfirmBody')),
      h(
        'div',
        { class: 'dsg-config-confirm-actions' },
        h(
          Button,
          {
            variant: 'primary',
            size: 'sm',
            class: 'dsg-config-danger',
            onClick: confirmDestructive,
          },
          t('config.destructiveConfirmEnable'),
        ),
        h(
          Button,
          {
            variant: 'ghost',
            size: 'sm',
            onClick: () => setDestructivePrompt(false),
          },
          t('config.destructiveConfirmCancel'),
        ),
      ),
    )
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
          ...CONFIG_FIELDS.map(([field, labelKey, hintKey, detailKey]) =>
            h(
              'div',
              { class: 'dsg-config-item', key: field, 'data-testid': `session-groups-config-${field}` },
              h(
                'div',
                { class: 'dsg-config-row' },
                h(
                  'div',
                  { class: 'dsg-config-copy' },
                  h('div', { class: 'dsg-config-label' }, t(labelKey)),
                  h('div', { class: 'dsg-config-proof' }, t(hintKey)),
                ),
                h(
                  'div',
                  { class: 'dsg-config-control' },
                  h(Tooltip, {
                    label: t(detailKey),
                    side: 'left',
                    portal: true,
                    openOnClick: true,
                    delayMs: 250,
                    maxWidth: 360,
                    children: h(
                      Button,
                      {
                        variant: 'ghost',
                        size: 'sm',
                        class: 'dsg-config-info',
                        'aria-label': t('config.detailsLabel', { name: t(labelKey) }),
                      },
                      h(IconInfoOutlineRegular, { size: 16 }),
                    ),
                  }),
                  h(Switch, {
                    checked: config[field] === true,
                    onChange: (next) => requestFieldChange(field, next),
                    label: t(labelKey),
                  }),
                ),
              ),
              renderConfirm(field),
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
        Button,
        {
          variant: 'outline',
          size: 'sm',
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
            result.ok
              ? t('skill.repairOk')
              : result.code === 'skill-user-owned'
                ? t('skill.repairUserOwned')
                : t('skill.repairFailed'),
            result.code ? ` (${result.code})` : '',
          )
        : null,
    ),
  )
}
