/**
 * Modal dialog host: group/session dialogs, selectors, geometry and color UI.
 * Extracted from components.js as a behavior-neutral split.
 */
import { createElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { clientRuntime as rt } from '../adapters/client-runtime.js'
import {
  currentColorHexOf,
  currentColorOf,
  currentGroupIdOf,
  currentIconOf,
  currentParentOf,
  deleteGroupOptions,
  dialogConfirmPayload,
  findGroupsFlat,
  initialDialogSelection,
  isSelectionDialog,
  moveGroupOptions,
  selectionIsValid,
} from '../core/dialog-selection.js'
import { GROUP_COLORS, GROUP_COLOR_HEX, GROUP_ICONS, MAX_GROUP_NAME, PLUGIN_VERSION } from '../shared/constants.js'
import { isColorHex, normalizeColorHex } from '../shared/model.js'
import { formatActivity, workspaceLabel } from './actions.js'
import {
  centeredDialogRect,
  clampDialogRect,
  dragDialogRect,
  readDialogGeometries,
  resizeDialogRect,
  saveDialogGeometry,
} from './dialog-geometry.js'
import { GroupListPicker } from './group-list-picker.js'
import { ICON_GROUPS, renderGlyph, renderIcon } from './icons.js'
import { ScrollArea } from './scroll-area.js'

const h = createElement
const dispatch = (action, payload) => rt()?.store.dispatch(action, payload)

export const DialogHost = ({ store, props }) => {
  const dialog = store.dialog
  const t = rt()?.t
  const [value, setValue] = useState('')
  const [selection, setSelection] = useState(undefined)
  const [hexInput, setHexInput] = useState('')
  const inputRef = useRef(null)
  const dialogRef = useRef(null)
  const [dialogRect, setDialogRect] = useState(null)
  const dialogRectRef = useRef(null)
  const gestureRef = useRef(null)
  const gestureCleanupRef = useRef(null)
  const debugSentRef = useRef(null)
  dialogRectRef.current = dialogRect
  useEffect(() => {
    if (!dialog) {
      setDialogRect(null)
      return
    }
    const saved = readDialogGeometries()[dialog.kind]
    setDialogRect(saved ? clampDialogRect(saved, globalThis.innerWidth, globalThis.innerHeight) : null)
  }, [dialog?.kind])

  // Measure the natural dialog once when there is no saved geometry; after that
  // the explicit rect is the single source of truth for drag/resize.
  useLayoutEffect(() => {
    if (!dialog || dialogRect !== null) return
    const element = dialogRef.current
    if (!element) return
    const box = element.getBoundingClientRect()
    const titlebar = element.querySelector('.dsg-dialog-titlebar')
    const content = element.querySelector('.dsg-dialog-content')
    const actions = element.querySelector('.dsg-dialog-actions')
    // The dialog is a column flex with gap:12px and 16px vertical padding, so
    // include the two gaps + padding + the 0.5px top/bottom border (which
    // becomes fractional at non-1 DPR) or the content bottom is clipped.
    const borderHeight =
      (Number.parseFloat(globalThis.getComputedStyle(element).borderTopWidth) || 0) +
      (Number.parseFloat(globalThis.getComputedStyle(element).borderBottomWidth) || 0)
    const laidOutHeight = Math.ceil(
      (titlebar?.offsetHeight ?? 0) +
        Math.ceil(content?.scrollHeight ?? 0) +
        (actions?.offsetHeight ?? 0) +
        57 +
        borderHeight
    )
    const naturalHeight = laidOutHeight || Math.ceil(box.height) || 320
    setDialogRect(
      centeredDialogRect(
        box.width || (dialog.kind === 'icon' ? 420 : 360),
        naturalHeight || 320,
        globalThis.innerWidth,
        globalThis.innerHeight
      )
    )
  }, [dialog, dialogRect])

  useEffect(() => {
    if (!dialog || dialogRect === null) return undefined
    const onResize = () => {
      const next = clampDialogRect(dialogRectRef.current ?? dialogRect, globalThis.innerWidth, globalThis.innerHeight)
      setDialogRect(next)
      saveDialogGeometry(dialog.kind, next)
    }
    globalThis.addEventListener('resize', onResize)
    return () => globalThis.removeEventListener('resize', onResize)
  }, [dialog?.kind, dialogRect === null])

  useEffect(() => {
    if (rt()?.debugProbe !== true) return undefined
    if (!dialog) {
      debugSentRef.current = null
      return undefined
    }
    if (debugSentRef.current === dialog.kind) return undefined
    debugSentRef.current = dialog.kind
    const timer = setTimeout(() => {
      const element = dialogRef.current
      if (!element || typeof globalThis.getComputedStyle !== 'function') return
      try {
        const bodyStyle = globalThis.getComputedStyle(globalThis.document.body)
        const dialogStyle = globalThis.getComputedStyle(element)
        const content = element.querySelector('.dsg-dialog-content')
        const input = element.querySelector('.dsg-dialog-input')
        const confirm = element.querySelector('.dsg-dialog-confirm')
        const contentStyle = content ? globalThis.getComputedStyle(content) : null
        const inputStyle = input ? globalThis.getComputedStyle(input) : null
        const confirmStyle = confirm ? globalThis.getComputedStyle(confirm) : null
        const tokenNames = [
          '--dsw-alias-bg-layer-1',
          '--dsw-alias-bg-layer-2',
          '--dsw-alias-button-primary-fill',
          '--dsw-alias-button-primary-hover',
          '--dsw-alias-label-primary-foreground',
          '--dsw-alias-border-l3',
          '--dsw-alias-border-l4',
          '--dsw-alias-label-primary',
          '--dsw-alias-label-secondary',
          '--dsh-scrollbar-thumb',
          '--dsh-scrollbar-thumb-hover',
          '--dsw-radius-panel',
        ]
        const tokens = Object.fromEntries(tokenNames.map((name) => [name, bodyStyle.getPropertyValue(name).trim()]))
        const payload = {
          pluginVersion: PLUGIN_VERSION,
          kind: dialog.kind,
          dark: globalThis.document.body?.getAttribute?.('data-ds-dark-theme'),
          dialog: {
            rect: element.getBoundingClientRect().toJSON?.() ?? null,
            background: dialogStyle.backgroundColor,
            color: dialogStyle.color,
            border: dialogStyle.border,
            borderRadius: dialogStyle.borderRadius,
            padding: dialogStyle.padding,
          },
          content: content
            ? {
                rect: content.getBoundingClientRect().toJSON?.() ?? null,
                flex: contentStyle?.flex,
                height: contentStyle?.height,
                scrollHeight: content.scrollHeight,
              }
            : null,
          input: input
            ? {
                rect: input.getBoundingClientRect().toJSON?.() ?? null,
                display: inputStyle?.display,
                height: inputStyle?.height,
                flex: inputStyle?.flex,
                opacity: inputStyle?.opacity,
                background: inputStyle?.backgroundColor,
                color: inputStyle?.color,
                border: inputStyle?.border,
              }
            : null,
          confirm: confirm
            ? {
                background: confirmStyle?.backgroundColor,
                color: confirmStyle?.color,
                height: confirmStyle?.height,
              }
            : null,
          scrollAreas: [...element.querySelectorAll('.dsg-scroll-area')].map((area) => {
            const scroller = area.firstElementChild
            const rail = [...area.children].find((child) => child.classList?.contains('dsg-scroll-rail')) ?? null
            const thumb = rail ? [...rail.children].find((child) => child.classList?.contains('dsg-scroll-thumb')) ?? null : null
            return {
              className: scroller?.className ?? '',
              clientHeight: scroller?.clientHeight ?? null,
              scrollHeight: scroller?.scrollHeight ?? null,
              max: scroller ? scroller.scrollHeight - scroller.clientHeight : null,
              rail: rail
                ? {
                    rect: rail.getBoundingClientRect().toJSON?.() ?? null,
                    display: getComputedStyle(rail).display,
                    opacity: getComputedStyle(rail).opacity,
                    zIndex: getComputedStyle(rail).zIndex,
                  }
                : null,
              thumb: thumb
                ? {
                    rect: thumb.getBoundingClientRect().toJSON?.() ?? null,
                    display: getComputedStyle(thumb).display,
                    background: getComputedStyle(thumb).backgroundColor,
                  }
                : null,
            }
          }),
          tokens,
        }
        void globalThis.fetch?.('/dsh-session-groups/debug', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(() => {})
      } catch {
        /* debug probe must never affect the dialog */
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [dialog?.kind])

  const beginDialogGesture = (event, dir = null) => {
    if (!dialog || event.button !== 0) return
    if (dir === null && event.target?.closest?.('button, input, textarea, select, a')) return
    const start = dialogRectRef.current
    if (!start) return
    event.preventDefault()
    event.stopPropagation()
    const doc = event.currentTarget?.ownerDocument ?? globalThis.document
    const gesture = { start, x: event.clientX, y: event.clientY, dir }
    gestureRef.current = gesture
    const onMove = (moveEvent) => {
      const current = gestureRef.current
      if (!current) return
      const dx = moveEvent.clientX - current.x
      const dy = moveEvent.clientY - current.y
      const next = current.dir
        ? resizeDialogRect(current.start, current.dir, dx, dy, globalThis.innerWidth, globalThis.innerHeight)
        : dragDialogRect(current.start, dx, dy, globalThis.innerWidth, globalThis.innerHeight)
      setDialogRect(next)
    }
    const onEnd = () => {
      const current = gestureRef.current
      gestureRef.current = null
      doc?.removeEventListener?.('pointermove', onMove)
      doc?.removeEventListener?.('pointerup', onEnd)
      doc?.removeEventListener?.('pointercancel', onEnd)
      gestureCleanupRef.current = null
      if (current && dialogRectRef.current) saveDialogGeometry(dialog.kind, dialogRectRef.current)
    }
    doc?.addEventListener?.('pointermove', onMove)
    doc?.addEventListener?.('pointerup', onEnd)
    doc?.addEventListener?.('pointercancel', onEnd)
    gestureCleanupRef.current = () => {
      doc?.removeEventListener?.('pointermove', onMove)
      doc?.removeEventListener?.('pointerup', onEnd)
      doc?.removeEventListener?.('pointercancel', onEnd)
    }
  }

  // A dialog can unmount mid-gesture; release its window listeners.
  useEffect(
    () => () => {
      gestureRef.current = null
      gestureCleanupRef.current?.()
      gestureCleanupRef.current = null
    },
    []
  )
  useEffect(() => {
    setValue(dialog?.value ?? '')
    // Every selection dialog opens with a visible current/inferred highlight;
    // when nothing usable exists Confirm stays disabled until the user picks.
    const initial = dialog ? initialDialogSelection(dialog, store.doc) : undefined
    setSelection(initial)
    setHexInput(dialog?.kind === 'group-color' && isColorHex(initial) ? initial : '')
    if (dialog && (dialog.kind === 'new-group' || dialog.kind === 'rename-group' || dialog.kind === 'rename-session')) {
      const timer = setTimeout(() => inputRef.current?.focus(), 10)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [dialog])
  if (!dialog) return null
  const close = () => dispatch('dialog', { dialog: null })
  const confirm = (payload) => rt()?.confirmDialog(dialog, payload)
  const errorText = dialog.error ? t(dialog.error === 'name-required' ? 'dialog.namePlaceholder' : dialog.error) : null
  const title = t(dialog.titleKey)
  const optionCheck = () => h('span', { class: 'dsg-dialog-option-check', 'aria-hidden': 'true' }, renderGlyph(h, 'check', 16))
  const bodyNodes = []
  if (dialog.kind === 'delete-group') {
    const options = deleteGroupOptions(store.doc, dialog.groupId)
    bodyNodes.push(
      h(
        'div',
        { class: 'dsg-dialog-body', 'data-testid': 'session-groups-dialog-delete-body' },
        t('dialog.deleteMoveBody', { sessions: dialog.sessionCount ?? 0, groups: dialog.childCount ?? 0 })
      )
    )
    bodyNodes.push(h('div', { class: 'dsg-dialog-body' }, t('dialog.deleteDestination')))
    bodyNodes.push(
      h(GroupListPicker, {
        options,
        selection,
        onSelect: setSelection,
        rootLabel: t('dialog.rootDestination'),
        ariaLabel: t('dialog.deleteDestination'),
        testId: 'session-groups-dialog-delete-options',
      })
    )
  }
  if (dialog.kind === 'archive-running') bodyNodes.push(h('div', { class: 'dsg-dialog-body' }, t('dialog.archiveRunningBody', { families: formatActivity(dialog.activity) })))
  if (dialog.kind === 'new-session') {
    if ((dialog.choices ?? []).length === 0) bodyNodes.push(h('div', { class: 'dsg-dialog-body' }, t('dialog.noWorkspace')))
    else {
      bodyNodes.push(h('div', { class: 'dsg-dialog-body' }, t('dialog.newSessionWorkspace')))
      bodyNodes.push(
        h(
          ScrollArea,
          {
            className: 'dsg-menu dsg-dialog-list',
            role: 'listbox',
            'data-testid': 'session-groups-dialog-options',
            'aria-label': t('dialog.newSessionWorkspace'),
          },
          ...dialog.choices.map((workspace) => {
            const active = selection === workspace.workspaceId
            return h(
              'button',
              {
                key: workspace.workspaceId,
                type: 'button',
                role: 'option',
                'aria-selected': active ? 'true' : 'false',
                class: 'dsg-menu-item dsg-dialog-option',
                'data-testid': 'session-groups-dialog-workspace',
                'data-workspace-id': workspace.workspaceId,
                'data-selected': active ? 'true' : 'false',
                onClick: (event) => {
                  event.stopPropagation()
                  setSelection(workspace.workspaceId)
                },
              },
              h(
                'span',
                { class: 'dsg-dialog-option-label' },
                `${workspaceLabel(workspace)}${workspace.workspaceId === dialog.inferred ? ' ★' : ''}`
              ),
              active ? optionCheck() : null
            )
          })
        )
      )
    }
  }
  if (dialog.kind === 'move-session' || dialog.kind === 'move-group') {
    const options = dialog.kind === 'move-group' ? moveGroupOptions(store.doc, dialog.groupId) : findGroupsFlat(store.doc)
    bodyNodes.push(h(GroupListPicker, {
      options,
      selection,
      onSelect: setSelection,
      allowRoot: dialog.kind !== 'move-group',
    }))
  }
  if (dialog.kind === 'icon') {
    const icons = Array.isArray(dialog.icons) ? dialog.icons : []
    const available = new Set(icons)
    const sections = ICON_GROUPS.map((section) => ({
      ...section,
      icons: section.icons.filter((icon) => available.has(icon)),
    })).filter((section) => section.icons.length > 0)
    const grouped = new Set(sections.flatMap((section) => section.icons))
    const leftovers = icons.filter((icon) => !grouped.has(icon))
    if (leftovers.length > 0) {
      const general = sections.find((section) => section.key === 'general')
      if (general) general.icons.push(...leftovers)
      else sections.push({ key: 'general', labelKey: 'iconGroup.general', icons: leftovers })
    }
    const iconButton = (icon) => {
      const active = selection === icon
      return h(
        'button',
        {
          key: icon,
          type: 'button',
          role: 'radio',
          'aria-checked': active ? 'true' : 'false',
          class: 'dsg-menu-item dsg-dialog-option dsg-icon-option',
          'data-testid': 'session-groups-dialog-icon',
          'data-icon': icon,
          'data-selected': active ? 'true' : 'false',
          title: t(`icon.${icon}`),
          onClick: (event) => {
            event.stopPropagation()
            setSelection(icon)
          },
        },
        renderIcon(h, icon, 16),
        h('span', { class: 'dsg-dialog-option-label' }, t(`icon.${icon}`))
      )
    }
    bodyNodes.push(
      h(
        ScrollArea,
        {
          className: 'dsg-icon-sections',
          'data-testid': 'session-groups-dialog-options',
          'aria-label': t('group.icon'),
        },
        ...sections.map((section, index) =>
          h(
            'section',
            {
              key: section.key,
              class: 'dsg-icon-section',
              'data-icon-group': section.key,
              'aria-label': t(section.labelKey),
            },
            h(
              'div',
              { class: 'dsg-icon-section-title' },
              t(section.labelKey)
            ),
            h(
              'div',
              {
                class: 'dsg-menu dsg-dialog-icon-grid',
                role: 'radiogroup',
                'aria-label': t(section.labelKey),
              },
              ...section.icons.map(iconButton)
            )
          )
        )
      )
    )
  }
  if (dialog.kind === 'group-color') {
    const customActive = isColorHex(selection)
    const hexValid = normalizeColorHex(hexInput) !== null
    const nativeValue = normalizeColorHex(hexInput) ?? (isColorHex(selection) ? selection : GROUP_COLOR_HEX[selection] ?? GROUP_COLOR_HEX.blue)
    const pickPreset = (color) => {
      setSelection(color)
      setHexInput('')
    }
    const changeHex = (raw) => {
      setHexInput(raw)
      const hex = normalizeColorHex(raw)
      setSelection(hex ?? undefined)
    }
    const pickNative = (raw) => {
      const hex = normalizeColorHex(raw)
      if (!hex) return
      setHexInput(hex)
      setSelection(hex)
    }
    const hint = hexInput.trim() === '' || hexValid ? t('color.hint') : t('color.invalidHex')
    bodyNodes.push(
      h(
        'div',
        {
          class: 'dsg-color-grid',
          role: 'radiogroup',
          'data-testid': 'session-groups-dialog-options',
          'aria-label': t('dialog.groupColor'),
        },
        ...GROUP_COLORS.map((color) => {
          const active = selection === color
          return h(
            'button',
            {
              key: color,
              type: 'button',
              role: 'radio',
              'aria-checked': active ? 'true' : 'false',
              class: 'dsg-dialog-option dsg-color-option',
              'data-testid': 'session-groups-dialog-color',
              'data-color': color,
              'data-selected': active ? 'true' : 'false',
              title: t(`color.${color}`),
              onClick: (event) => {
                event.stopPropagation()
                pickPreset(color)
              },
            },
            h('span', { class: 'dsg-color-swatch', 'aria-hidden': 'true', style: { background: `var(--dsg-color-${color})` } }),
            h('span', { class: 'dsg-dialog-option-label' }, t(`color.${color}`)),
            // 0.2.7: the check slot is always present and only hidden, so the
            // label column never shifts when selection moves between cells.
            h(
              'span',
              {
                class: 'dsg-dialog-option-check',
                'data-testid': 'session-groups-dialog-color-check',
                'data-empty': active ? 'false' : 'true',
                'aria-hidden': 'true',
                style: { visibility: active ? 'visible' : 'hidden' },
              },
              renderGlyph(h, 'check', 16)
            )
          )
        })
      )
    )
    bodyNodes.push(
      h(
        'div',
        { class: 'dsg-color-custom-row', 'data-selected': customActive ? 'true' : 'false' },
        h('span', { class: 'dsg-color-custom-label' }, t('color.custom')),
        h('input', {
          type: 'color',
          class: 'dsg-color-native',
          'data-testid': 'session-groups-dialog-color-native',
          'aria-label': t('color.custom'),
          value: nativeValue,
          onChange: (event) => pickNative(event.target.value),
        }),
        h('input', {
          type: 'text',
          class: 'dsg-dialog-input dsg-color-hex',
          'data-testid': 'session-groups-dialog-color-hex',
          maxlength: '7',
          spellcheck: 'false',
          autocomplete: 'off',
          placeholder: '#RRGGBB',
          'aria-label': t('color.customHex'),
          value: hexInput,
          onChange: (event) => changeHex(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Escape') close()
          },
        })
      )
    )
    bodyNodes.push(
      h(
        'div',
        {
          class: 'dsg-color-hint',
          'data-testid': 'session-groups-dialog-color-hint',
          'data-tone': hexInput.trim() !== '' && !hexValid ? 'error' : 'hint',
          'aria-live': 'polite',
        },
        hint
      )
    )
  }
  const needsInput = dialog.kind === 'new-group' || dialog.kind === 'rename-group' || dialog.kind === 'rename-session'
  const selectable = isSelectionDialog(dialog.kind)
  const danger = dialog.kind === 'delete-group' || dialog.kind === 'archive-running'
  const canConfirm = needsInput ? value.trim().length > 0 : selectable ? selectionIsValid(dialog, selection, store.doc) : true
  return h(
    'div',
    {
      class: 'dsg-dialog-backdrop',
      // Backdrop click deliberately does not close independent dialogs. The
      // user closes via Cancel/Escape or the explicit action.
    },
    h(
      'div',
      {
        ref: dialogRef,
        class: 'dsg-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'data-testid': 'session-groups-dialog',
        'data-kind': dialog.kind,
        'data-positioned': dialogRect ? 'true' : 'false',
        style: dialogRect
          ? {
              left: `${dialogRect.x}px`,
              top: `${dialogRect.y}px`,
              width: `${dialogRect.width}px`,
              height: `${dialogRect.height}px`,
            }
          : undefined,
      },
      h(
        'div',
        {
          class: 'dsg-dialog-titlebar',
          onPointerDown: (event) => beginDialogGesture(event),
        },
        h('div', { class: 'dsg-dialog-title' }, title)
      ),
      h(
        ScrollArea,
        { className: 'dsg-dialog-content' },
        ...bodyNodes,
        needsInput
          ? h('input', {
              ref: inputRef,
              class: 'dsg-dialog-input',
              'data-testid': 'session-groups-dialog-input',
              value,
              maxlength: String(MAX_GROUP_NAME),
              placeholder: t('dialog.namePlaceholder'),
              onChange: (event) => setValue(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && canConfirm) confirm({ value: value.trim() })
                if (event.key === 'Escape') close()
              },
            })
          : null,
        errorText ? h('div', { class: 'dsg-dialog-error' }, errorText) : null
      ),
      h(
        'div',
        { class: 'dsg-dialog-actions' },
        h('button', { type: 'button', class: 'dsg-dialog-cancel', 'data-testid': 'session-groups-dialog-cancel', onClick: close }, t('dialog.cancel')),
        h(
          'button',
          {
            type: 'button',
            class: 'dsg-dialog-confirm',
            'data-testid': 'session-groups-dialog-confirm',
            'data-variant': danger ? 'danger' : 'primary',
            disabled: !canConfirm,
            onClick: () =>
              confirm(needsInput ? { value: value.trim() } : selectable ? dialogConfirmPayload(dialog, selection) : {}),
          },
          danger ? (dialog.kind === 'delete-group' ? t('dialog.moveAndDelete') : t('dialog.stopAndArchive')) : t('dialog.confirm')
        )
      ),
      ...['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'].map((dir) =>
        h('div', {
          key: dir,
          class: 'dsg-dialog-resizer',
          'data-dir': dir,
          'aria-hidden': 'true',
          onPointerDown: (event) => beginDialogGesture(event, dir),
        })
      )
    )
  )
}

