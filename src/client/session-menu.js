/**
 * Session/group row menu and toast presentation.
 *
 * Extracted from components.js as a behavior-neutral split. The menu keeps the
 * same DOM/test ids and delegates all mutations to the shell handlers.
 */
import { createElement, useEffect, useLayoutEffect, useRef } from 'react'
import { clientRuntime as rt } from '../adapters/client-runtime.js'
import { clampMenuPosition } from '../core/menu-position.js'
import { siblingNeighbors } from '../core/tree.js'

const h = createElement

/** Restore focus to the row that opened a group/session menu. */
const menuSourceRow = (menu) => {
  if (!menu) return null
  const testId = menu.kind === 'group' ? 'session-groups-group' : 'session-groups-session'
  const attr = menu.kind === 'group' ? 'data-group-id' : 'data-session-id'
  const value = menu.kind === 'group' ? menu.groupId : menu.sessionId
  const rows = globalThis.document?.querySelectorAll?.(`[data-testid="${testId}"]`) ?? []
  for (const row of rows) if (row.getAttribute?.(attr) === value) return row
  return null
}

export const Toast = ({ store }) => {
  const toastState = store.toast
  if (!toastState) return null
  return h('div', { class: 'dsg-toast', 'data-testid': 'session-groups-toast' }, toastState.message ?? '')
}

export const MenuPopover = ({ store, handlers }) => {
  const menu = store.menu
  const menuRef = useRef(null)
  // Refine the estimated anchor with the real menu rect so a ~275px group menu
  // is clamped to the viewport instead of relying on a hard-coded 200px guess.
  useLayoutEffect(() => {
    const node = menuRef.current
    if (!node || !menu) return
    const rect = node.getBoundingClientRect()
    const next = clampMenuPosition({
      x: menu.anchorX ?? menu.x,
      y: menu.anchorY ?? menu.y,
      width: rect.width,
      height: rect.height,
      viewportWidth: globalThis.innerWidth,
      viewportHeight: globalThis.innerHeight,
    })
    node.style.left = `${next.x}px`
    node.style.top = `${next.y}px`
  }, [menu])
  // Focus the first item when the menu opens; when it closes (Escape, outside,
  // scroll, resize or an action) focus returns to the originating row.
  useEffect(() => {
    if (!menu) return undefined
    const node = menuRef.current
    const first = node?.querySelector?.('button:not([disabled])')
    ;(first ?? node)?.focus?.({ preventScroll: true })
    return () => {
      menuSourceRow(menu)?.focus?.({ preventScroll: true })
    }
  }, [menu])
  if (!menu) return null
  const t = rt()?.t
  const item = (key, label, onClick, extra = {}) =>
    h('button', { key, type: 'button', role: 'menuitem', class: 'dsg-menu-item', onClick: (event) => { event.stopPropagation(); handlers.closeMenu(); onClick() }, ...extra }, label)
  const children = []
  if (menu.kind === 'group') {
    const { previous, next } = siblingNeighbors(store.doc, menu.groupId)
    const moveItem = (key, label, testid, disabled, delta) =>
      item(key, label, () => handlers.moveGroupStep(menu.groupId, delta), {
        'data-testid': testid,
        'data-group-id': menu.groupId,
        'data-disabled': disabled ? 'true' : 'false',
        ...(disabled ? { disabled: true } : {}),
      })
    children.push(item('new-subgroup', t('group.newSubgroup'), () => handlers.openNewGroup(null, menu.groupId)))
    children.push(item('rename', t('group.rename'), () => handlers.openRenameGroup(menu.groupId)))
    children.push(item('icon', t('group.icon'), () => handlers.openIconGroup(menu.groupId)))
    children.push(item('color', t('group.color'), () => handlers.openGroupColor(menu.groupId)))
    children.push(item('move', t('group.moveTo'), () => handlers.openMoveGroup(menu.groupId)))
    children.push(moveItem('move-up', t('group.moveUp'), 'session-groups-group-move-up', previous === null, -1))
    children.push(moveItem('move-down', t('group.moveDown'), 'session-groups-group-move-down', next === null, 1))
    children.push(h('div', { key: 'sep', class: 'dsg-menu-separator' }))
    children.push(item('delete', t('group.delete'), () => handlers.openDeleteGroup(menu.groupId)))
  } else if (menu.kind === 'session') {
    children.push(item('rename', t('session.rename'), () => handlers.openRenameSession(menu.sessionId, menu.title)))
    if (menu.blank !== true && rt()?.capabilities.fork?.(menu.sessionId) === true) {
      children.push(item('fork', t('session.fork'), () => handlers.forkSession(menu.sessionId)))
    }
    children.push(
      menu.archived
        ? item('unarchive', t('session.unarchive'), () => handlers.unarchiveSession(menu.sessionId))
        : item('archive', t('session.archive'), () => handlers.archiveSession(menu.sessionId))
    )
    children.push(item('copy-id', t('session.copyId'), () => handlers.copySessionId(menu.sessionId)))
    children.push(item('move', t('session.moveTo'), () => handlers.openMoveSession(menu.sessionId)))
  }
  return h(
    'div',
    {
      ref: menuRef,
      class: 'dsg-menu',
      role: 'menu',
      tabindex: '-1',
      'data-testid': 'session-groups-menu',
      'data-menu-kind': menu.kind,
      'data-source-id': menu.kind === 'group' ? menu.groupId : menu.sessionId,
      style: { left: `${menu.x}px`, top: `${menu.y}px` },
      onClick: (event) => event.stopPropagation(),
    },
    ...children
  )
}
