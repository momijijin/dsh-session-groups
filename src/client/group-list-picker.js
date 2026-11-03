/**
 * Move-to-group option list (0.2.6). A click only highlights the row
 * (`aria-selected`); the shared dialog footer owns the actual move, so a stray
 * click can never move a session or group by itself.
 */
import { createElement } from 'react'
import { clientRuntime as rt } from '../adapters/client-runtime.js'
import { renderGlyph } from './icons.js'
import { ScrollArea } from './scroll-area.js'

const h = createElement

export const GroupListPicker = ({ options, selection, onSelect, rootLabel, ariaLabel, allowRoot = true, testId = 'session-groups-dialog-options' }) => {
  const t = rt()?.t
  const option = (key, value, label, depth) =>
    h(
      'button',
      {
        key,
        type: 'button',
        role: 'option',
        'aria-selected': selection === value ? 'true' : 'false',
        class: 'dsg-menu-item dsg-dialog-option',
        'data-testid': 'session-groups-dialog-group',
        'data-group-id': value ?? '',
        'data-selected': selection === value ? 'true' : 'false',
        style: { paddingLeft: `${12 + depth * 16}px` },
        onClick: (event) => {
          event.stopPropagation()
          onSelect(value)
        },
      },
      h('span', { class: 'dsg-dialog-option-label' }, label),
      selection === value
        ? h('span', { class: 'dsg-dialog-option-check', 'aria-hidden': 'true' }, renderGlyph(h, 'check', 16))
        : null
    )
  return h(
    ScrollArea,
    {
      className: 'dsg-menu dsg-dialog-list',
      role: 'listbox',
      'data-testid': testId,
      'aria-label': ariaLabel ?? t('dialog.moveTo'),
    },
    allowRoot ? option('ungrouped', null, rootLabel ?? t('ungrouped.title'), 0) : null,
    ...options.flatMap((group, index) => {
      const nodes = []
      if (group.depth === 0 && index > 0) {
        nodes.push(
          h('div', {
            key: `separator:${group.id}`,
            class: 'dsg-dialog-group-separator',
            role: 'presentation',
            'aria-hidden': 'true',
          })
        )
      }
      nodes.push(option(group.id, group.id, group.name, group.depth + 1))
      return nodes
    })
  )
}
