/**
 * Selection-dialog logic (0.2.6).
 *
 * The small picker dialogs (icon, move-to-group, new-session workspace and the
 * new group-color dialog) share one interaction contract: clicking an option
 * only highlights it (`aria-selected`/`aria-checked`), the footer Confirm button
 * applies the current selection and Cancel closes without writing. These pure
 * helpers own the initial selection, validity and confirm payload so the React
 * component only renders state; unit tests cover the full matrix without a DOM.
 */
import { DEFAULT_GROUP_COLOR, DEFAULT_ICON, GROUP_COLORS, GROUP_ICONS } from '../shared/constants.js'
import { findGroup, groupColor, isDescendant, isKnownColor } from '../shared/model.js'

/** Dialog kinds whose body is a selectable option list. */
export const SELECTION_DIALOG_KINDS = Object.freeze(['new-session', 'move-session', 'move-group', 'icon', 'group-color'])

export const isSelectionDialog = (kind) => SELECTION_DIALOG_KINDS.includes(kind)

/** Flat depth-first group list (root first), used by the move pickers. */
export const findGroupsFlat = (doc) => {
  const out = []
  const walk = (parentId, depth) => {
    for (const group of doc.groups.filter((item) => item.parentId === parentId)) {
      out.push({ ...group, depth })
      walk(group.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/**
 * Options offered by a move-group dialog: every group except the moved group
 * and its descendants (those would be rejected as cycles anyway). The implicit
 * "Ungrouped" (root) option is rendered by the component as `null`.
 */
export const moveGroupOptions = (doc, groupId) =>
  findGroupsFlat(doc).filter((group) => group.id !== groupId && !isDescendant(doc, group.id, groupId))

/**
 * Initial highlight for a selection dialog. `move-*` dialogs store the current
 * location in `currentId` (a group id or `null` for Ungrouped/root). Icon and
 * color dialogs start on the group's current value; new-session prefers the
 * inferred workspace. A missing/unusable value yields `undefined` (no
 * selection), which disables Confirm instead of silently defaulting to the
 * first row.
 */
export const initialDialogSelection = (dialog, doc) => {
  if (!dialog) return undefined
  switch (dialog.kind) {
    case 'icon': {
      const icons = Array.isArray(dialog.icons) ? dialog.icons : GROUP_ICONS
      return typeof dialog.current === 'string' && icons.includes(dialog.current) ? dialog.current : DEFAULT_ICON
    }
    case 'group-color':
      return isKnownColor(dialog.current) ? dialog.current : DEFAULT_GROUP_COLOR
    case 'new-session': {
      const choices = Array.isArray(dialog.choices) ? dialog.choices : []
      return choices.some((workspace) => workspace?.workspaceId === dialog.inferred) ? dialog.inferred : undefined
    }
    case 'move-session':
    case 'move-group':
      return dialog.currentId === undefined ? undefined : dialog.currentId
    default:
      return undefined
  }
}

/** Whether a highlighted value can be applied for this dialog. */
export const selectionIsValid = (dialog, selection, doc) => {
  if (!dialog) return false
  switch (dialog.kind) {
    case 'icon': {
      const icons = Array.isArray(dialog.icons) ? dialog.icons : GROUP_ICONS
      return typeof selection === 'string' && icons.includes(selection)
    }
    case 'group-color':
      return isKnownColor(selection)
    case 'new-session': {
      const choices = Array.isArray(dialog.choices) ? dialog.choices : []
      return choices.some((workspace) => workspace?.workspaceId === selection)
    }
    case 'move-session':
      return selection === null || (typeof selection === 'string' && findGroup(doc, selection) !== null)
    case 'move-group': {
      if (selection === null) return true
      if (typeof selection !== 'string' || selection === dialog.groupId) return false
      if (!findGroup(doc, selection)) return false
      return !isDescendant(doc, selection, dialog.groupId)
    }
    default:
      return false
  }
}

/** Payload handed to `confirmDialog` once the user confirms the selection. */
export const dialogConfirmPayload = (dialog, selection) => {
  if (!dialog) return {}
  switch (dialog.kind) {
    case 'icon':
      return { icon: selection }
    case 'group-color':
      return { color: selection }
    case 'new-session':
      return { workspaceId: selection }
    case 'move-session':
    case 'move-group':
      return { groupId: selection }
    default:
      return {}
  }
}

/** Current display value for the icon dialog (group icon at open time). */
export const currentIconOf = (doc, groupId) => findGroup(doc, groupId)?.icon ?? DEFAULT_ICON

/** Current display value for the color dialog (blue fallback for legacy docs). */
export const currentColorOf = (doc, groupId) => groupColor(findGroup(doc, groupId))

/** Current parent id for the move-group dialog (`null` means root). */
export const currentParentOf = (doc, groupId) => findGroup(doc, groupId)?.parentId ?? null

/** Current owning group id for the move-session dialog (`null` = ungrouped). */
export const currentGroupIdOf = (doc, sessionId) => {
  for (const group of doc.groups) {
    if (group.sessionIds.includes(sessionId)) return group.id
  }
  return null
}
