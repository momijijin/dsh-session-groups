/**
 * Locale dictionaries + translator for the groups client half.
 *
 * The plugin registers these dictionaries with the host locale service when it
 * exists and re-renders on locale changes (the service exposes
 * getSnapshot/subscribe); without the service it falls back to Chinese.
 * `locale/zh.json` / `locale/en.json` mirror these dictionaries for packaging and
 * are checked for parity by tests/client/locale.test.js.
 */

/** Locale namespace owned by this plugin. */
export const LOCALE_NS = 'dsh-session-groups'

/** Simplified Chinese dictionary (key-set source of truth). */
export const zh = {
  'view.title': '分组',
  'view.returnWorkspace': '返回工作区',
  'view.newGroup': '新建分组',
  'view.more': '更多',
  'view.options': '视图选项',
  'footer.toGroups': '分组视图',
  'footer.toWorkspace': '工作区视图',
  'archive.hidden': '隐藏已归档',
  'archive.all': '全部对话（显示已归档）',
  'archive.only': '仅显示已归档',
  'archive.label': '归档筛选',
  'group.empty': '空分组，拖入会话',
  'group.addSession': '在分组内新建会话',
  'group.menu': '分组操作',
  'group.rename': '重命名分组',
  'group.delete': '删除分组',
  'group.newSubgroup': '新建子分组',
  'group.moveTo': '移动到分组…',
  'group.moveUp': '上移',
  'group.moveDown': '下移',
  'group.icon': '更换图标',
  'group.sessionCount': '{n} 个会话',
  'drag.groupBefore': '放入『{name}』前',
  'drag.groupAfter': '放入『{name}』后',
  'drag.groupInto': '放入『{name}』内',
  'drag.groupRootEnd': '移到根级末尾',
  'drag.groupInvalid': '不能放入自身或子分组',
  'drag.depthExceeded': '超过最大分组层级（8 层）',
  'ungrouped.title': '未归组',
  'ungrouped.dropHint': '拖到这里移出分组',
  'session.blank': '新会话',
  'session.untitled': '未命名',
  'session.noWorkspace': '无工作区',
  'session.menu': '会话操作',
  'session.rename': '重命名',
  'session.archive': '归档',
  'session.unarchive': '取消归档',
  'session.pin': '置顶',
  'session.unpin': '取消置顶',
  'session.moveTo': '移动到分组…',
  'session.archivedBadge': '已归档',
  'session.open': '打开会话',
  'status.idle': '空闲',
  'status.running': '运行中',
  'status.waitingApproval': '等待审批',
  'status.planReview': '计划待审',
  'status.waitingAnswer': '等待回答',
  'status.completed': '已完成',
  'dialog.newGroup': '新建分组',
  'dialog.newSubgroup': '新建子分组',
  'dialog.renameGroup': '重命名分组',
  'dialog.renameSession': '重命名会话',
  'dialog.deleteGroup': '删除分组',
  'dialog.moveTo': '移动到分组',
  'dialog.newSession': '在分组内新建会话',
  'dialog.newSessionWorkspace': '选择工作区',
  'dialog.namePlaceholder': '分组名称',
  'dialog.confirm': '确定',
  'dialog.cancel': '取消',
  'dialog.deleteBody': '子分组将提升到上一级，{n} 个会话移动到上一级或未归组；不会删除或归档任何会话。',
  'dialog.archiveRunning': '会话正在运行',
  'dialog.archiveRunningBody': '该会话有正在进行的活动（{families}）。仍然归档会停止这些活动。',
  'dialog.stopAndArchive': '停止并归档',
  'dialog.noWorkspace': '当前没有可用工作区，请先在官方侧栏添加工作区。',
  'dialog.createFailed': '新建会话失败，请稍后重试。',
  'banner.loadFailed': '分组数据加载失败，已降级为扁平列表。',
  'banner.routeUnavailable': '分组服务不可用，已降级为扁平列表。',
  'banner.commitFailed': '分组数据保存失败，已恢复到上一次确认的状态。',
  'banner.conflict': '分组数据已在别处更新，已加载最新版本。',
  'banner.corrupt-file': '分组记录文件损坏，已按空分组启动（原文件已保留）。',
  'banner.invalid-file': '分组记录内容异常，已按空分组启动。',
  'banner.retry': '重试',
  'banner.dismiss': '关闭',
  'flat.title': '会话（扁平列表）',
  'rail.expand': '打开侧边栏（分组视图）',
  'rail.groups': '分组',
  'width.handle': '调整侧边栏宽度',
  'width.resetHint': '双击恢复默认宽度（420）',
  'toast.saved': '分组已保存',
  'toast.renameFailed': '重命名失败',
  'toast.archiveFailed': '归档失败',
  'toast.unarchiveFailed': '取消归档失败',
  'toast.pinFailed': '置顶失败',
  'toast.sessionStillRunning': '会话仍在运行',
  'toast.createFailed': '新建会话失败',
  'toast.archivedFilterChanged': '当前筛选为“仅已归档”，已切换到“全部”。',
  'toast.moved': '已移动',
  'toast.groupDeleted': '分组已删除',
  'toast.dropFailed': '移动失败',
  'error.title': '分组视图出错了',
  'error.body': '已降级为扁平会话列表，可切回工作区视图或重试。',
  'error.retry': '重试',
  'empty.none': '暂无会话',
  'search.label': '搜索会话',
  'search.placeholder': '搜索会话…',
  'search.results': '搜索结果',
  'search.empty': '没有匹配的会话',
  'search.close': '关闭搜索',
  'search.archivedDisabled': '已归档会话不可打开',
}

/** English dictionary (complete relative to zh). */
export const en = {
  'view.title': 'Groups',
  'view.returnWorkspace': 'Back to workspaces',
  'view.newGroup': 'New group',
  'view.more': 'More',
  'view.options': 'View options',
  'footer.toGroups': 'Group view',
  'footer.toWorkspace': 'Workspace view',
  'archive.hidden': 'Hide archived',
  'archive.all': 'All conversations (archived shown)',
  'archive.only': 'Archived only',
  'archive.label': 'Archive filter',
  'group.empty': 'Empty group — drop sessions here',
  'group.addSession': 'New session in this group',
  'group.menu': 'Group actions',
  'group.rename': 'Rename group',
  'group.delete': 'Delete group',
  'group.newSubgroup': 'New subgroup',
  'group.moveTo': 'Move to group…',
  'group.moveUp': 'Move up',
  'group.moveDown': 'Move down',
  'group.icon': 'Change icon',
  'group.sessionCount': '{n} sessions',
  'drag.groupBefore': 'Drop before “{name}”',
  'drag.groupAfter': 'Drop after “{name}”',
  'drag.groupInto': 'Drop into “{name}”',
  'drag.groupRootEnd': 'Move to the root end',
  'drag.groupInvalid': 'Cannot drop into the group itself or its descendant',
  'drag.depthExceeded': 'Exceeds the maximum group depth (8)',
  'ungrouped.title': 'Ungrouped',
  'ungrouped.dropHint': 'Drop here to remove from groups',
  'session.blank': 'New session',
  'session.untitled': 'Untitled',
  'session.noWorkspace': 'No workspace',
  'session.menu': 'Session actions',
  'session.rename': 'Rename',
  'session.archive': 'Archive',
  'session.unarchive': 'Unarchive',
  'session.pin': 'Pin',
  'session.unpin': 'Unpin',
  'session.moveTo': 'Move to group…',
  'session.archivedBadge': 'Archived',
  'session.open': 'Open session',
  'status.idle': 'Idle',
  'status.running': 'Running',
  'status.waitingApproval': 'Waiting for approval',
  'status.planReview': 'Plan review',
  'status.waitingAnswer': 'Waiting for answer',
  'status.completed': 'Completed',
  'dialog.newGroup': 'New group',
  'dialog.newSubgroup': 'New subgroup',
  'dialog.renameGroup': 'Rename group',
  'dialog.renameSession': 'Rename session',
  'dialog.deleteGroup': 'Delete group',
  'dialog.moveTo': 'Move to group',
  'dialog.newSession': 'New session in group',
  'dialog.newSessionWorkspace': 'Choose a workspace',
  'dialog.namePlaceholder': 'Group name',
  'dialog.confirm': 'Confirm',
  'dialog.cancel': 'Cancel',
  'dialog.deleteBody': 'Subgroups move up one level and {n} sessions move to the parent level or Ungrouped; no session is deleted or archived.',
  'dialog.archiveRunning': 'Session is running',
  'dialog.archiveRunningBody': 'This session has activity in progress ({families}). Archiving stops that activity.',
  'dialog.stopAndArchive': 'Stop and archive',
  'dialog.noWorkspace': 'No workspace is available — add one from the shipped sidebar first.',
  'dialog.createFailed': 'Creating the session failed. Please retry.',
  'banner.loadFailed': 'Loading group data failed — fell back to a flat list.',
  'banner.routeUnavailable': 'Group service is unavailable — fell back to a flat list.',
  'banner.commitFailed': 'Saving group data failed — reverted to the last confirmed state.',
  'banner.conflict': 'Group data changed elsewhere — the latest version was loaded.',
  'banner.corrupt-file': 'The group file was corrupt; started with an empty document (original preserved).',
  'banner.invalid-file': 'The group data was invalid; started with an empty document.',
  'banner.retry': 'Retry',
  'banner.dismiss': 'Dismiss',
  'flat.title': 'Sessions (flat list)',
  'rail.expand': 'Open sidebar (group view)',
  'rail.groups': 'Groups',
  'width.handle': 'Resize sidebar',
  'width.resetHint': 'Double-click to reset the width (420)',
  'toast.saved': 'Groups saved',
  'toast.renameFailed': 'Rename failed',
  'toast.archiveFailed': 'Archive failed',
  'toast.unarchiveFailed': 'Unarchive failed',
  'toast.pinFailed': 'Pin failed',
  'toast.sessionStillRunning': 'The session is still running',
  'toast.createFailed': 'Creating the session failed',
  'toast.archivedFilterChanged': 'The filter was “Archived only” — switched to “All”.',
  'toast.moved': 'Moved',
  'toast.groupDeleted': 'Group deleted',
  'toast.dropFailed': 'Move failed',
  'error.title': 'The groups view failed',
  'error.body': 'Fell back to the flat session list — switch back to workspaces or retry.',
  'error.retry': 'Retry',
  'empty.none': 'No sessions',
  'search.label': 'Search sessions',
  'search.placeholder': 'Search sessions…',
  'search.results': 'Search results',
  'search.empty': 'No matching sessions',
  'search.close': 'Close search',
  'search.archivedDisabled': 'Archived sessions cannot be opened',
}

/** Dictionaries keyed by host locale id prefix. */
export const dictionaries = Object.freeze({ zh, en })

/** Pick a dictionary for a locale id (`en*` -> English, else Chinese). */
export const dictionaryFor = (localeId) => (typeof localeId === 'string' && localeId.toLowerCase().startsWith('en') ? en : zh)

/**
 * Translate one key with `{name}` placeholder substitution.
 * Missing keys fall back to the Chinese dictionary, then to the key itself.
 */
export const formatMessage = (dict, key, params = {}) => {
  const template = dict?.[key] ?? zh[key] ?? key
  if (!params || typeof template !== 'string') return template
  return template.replace(/\{(\w+)\}/g, (match, name) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match))
}

/**
 * Create a translator bound to a locale snapshot getter.
 * @param {() => ({ id?: string } | null | undefined)} [getLocaleSnapshot]
 */
export const createTranslator = (getLocaleSnapshot) => (key, params) => {
  let localeId = 'zh'
  try {
    localeId = getLocaleSnapshot?.()?.id ?? 'zh'
  } catch {
    localeId = 'zh'
  }
  return formatMessage(dictionaryFor(localeId), key, params)
}
