/**
 * Dialog/command handlers for the groups view.
 *
 * These are user commands that open dialogs or start optimistic moves. They are
 * deliberately separate from menu anchoring and drag mechanics.
 */
import { clientRuntime as rt } from '../adapters/client-runtime.js'
import { childrenOf, findGroup, moveGroup } from '../shared/model.js'
import { assignSession } from '../shared/model.js'
import { currentColorHexOf, currentColorOf, currentGroupIdOf, currentIconOf, currentParentOf, deleteGroupNeedsDialog } from '../core/dialog-selection.js'
import { sessionContainer } from '../core/tree.js'
import { GROUP_ICONS } from '../shared/constants.js'
import { workspaceChoices } from './actions.js'
import { GROUP_DROP_NOOP } from '../core/group-drag.js'

export const createDialogHandlers = ({ store, t, byId, workspaceItems, currentId }) => {
  const moveGroupStep = (groupId, delta) => {
    const task = rt()?.commitOptimistic((latest) => {
      const group = findGroup(latest, groupId)
      if (!group) throw GROUP_DROP_NOOP
      const siblings = childrenOf(latest, group.parentId)
      const currentIndex = siblings.findIndex((item) => item.id === groupId)
      const nextIndex = currentIndex + delta
      if (currentIndex === -1 || nextIndex < 0 || nextIndex >= siblings.length) throw GROUP_DROP_NOOP
      return moveGroup(latest, groupId, group.parentId, nextIndex)
    })
    task?.catch((error) => {
      if (error === GROUP_DROP_NOOP || error?.reported === true) return
      if (globalThis.console?.warn) globalThis.console.warn('[dsh-session-grove] group move failed', error)
    })
  }

  const moveSessionStep = (sessionId, delta) => {
    const task = rt()?.commitOptimistic((latest) => {
      const container = sessionContainer(latest, sessionId)
      if (!container.ids) throw GROUP_DROP_NOOP
      const currentIndex = container.ids.indexOf(sessionId)
      const nextIndex = currentIndex + delta
      if (currentIndex === -1 || nextIndex < 0 || nextIndex >= container.ids.length) throw GROUP_DROP_NOOP
      return assignSession(latest, sessionId, container.groupId, nextIndex)
    })
    task?.catch((error) => {
      if (error === GROUP_DROP_NOOP || error?.reported === true) return
      if (globalThis.console?.warn) globalThis.console.warn('[dsh-session-grove] session move failed', error)
    })
  }

  return {
    moveGroupStep,
    moveSessionStep,
    openNewGroup: (event, parentId) => rt()?.openDialog({ kind: 'new-group', parentId, titleKey: parentId ? 'dialog.newSubgroup' : 'dialog.newGroup' }),
    openRenameGroup: (groupId) => rt()?.openDialog({ kind: 'rename-group', groupId, titleKey: 'dialog.renameGroup', value: findGroup(store.doc, groupId)?.name ?? '' }),
    openIconGroup: (groupId) =>
      rt()?.openDialog({ kind: 'icon', groupId, titleKey: 'group.icon', icons: [...GROUP_ICONS], current: currentIconOf(store.doc, groupId) }),
    openGroupColor: (groupId) =>
      rt()?.openDialog({
        kind: 'group-color',
        groupId,
        titleKey: 'dialog.groupColor',
        current: currentColorOf(store.doc, groupId),
        currentHex: currentColorHexOf(store.doc, groupId),
      }),
    openMoveGroup: (groupId) =>
      rt()?.openDialog({ kind: 'move-group', groupId, titleKey: 'dialog.moveGroup', currentId: currentParentOf(store.doc, groupId) }),
    openDeleteGroup: (groupId) => {
      const group = findGroup(store.doc, groupId)
      if (!group) return undefined
      if (!deleteGroupNeedsDialog(store.doc, groupId)) return rt()?.deleteGroupDirect?.(groupId)
      rt()?.openDialog({
        kind: 'delete-group',
        groupId,
        titleKey: 'dialog.deleteGroup',
        sessionCount: group.sessionIds.length,
        childCount: childrenOf(store.doc, groupId).length,
      })
      return undefined
    },
    openNewSession: (event, groupId) => {
      const choices = workspaceChoices(store.doc, groupId, byId, workspaceItems, currentId)
      if (choices.choices.length === 0 && rt()?.canCreateWorkspace?.() !== true) {
        rt()?.showToast('error', t('dialog.noWorkspace'))
        return
      }
      rt()?.openDialog({ kind: 'new-session', groupId, titleKey: 'dialog.newSession', choices: choices.choices, inferred: choices.inferred })
    },
    openRenameSession: (sessionId, title) => rt()?.openDialog({ kind: 'rename-session', sessionId, titleKey: 'dialog.renameSession', value: title ?? '' }),
    openMoveSession: (sessionId) =>
      rt()?.openDialog({ kind: 'move-session', sessionId, titleKey: 'dialog.moveSession', currentId: currentGroupIdOf(store.doc, sessionId) }),
    archiveSession: (sessionId) => rt()?.archiveSession(sessionId),
    unarchiveSession: (sessionId) => rt()?.unarchiveSession(sessionId),
    forkSession: (sessionId) => rt()?.forkSession(sessionId),
    copySessionId: (sessionId) => rt()?.copySessionId(sessionId),
  }
}
