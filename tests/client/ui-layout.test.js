// tests/client/ui-layout.test.js
//
// 0.2.2 UI-layout contract: footer two-segment switch, theme-aware surfaces,
// header action order and the view-options archive menu. Pure source/CSS
// assertions keep the host-DOM details covered by E2E step 1/2/16/17.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { CSS } from '../../src/client/css.js'
import { ICON_GROUPS } from '../../src/client/icons.js'
import { SESSION_WATERMARK_AUTO_MAX, SESSION_WATERMARK_BASE } from '../../src/shared/constants.js'
import { en, zh } from '../../src/client/locale.js'
import { UI_GLYPHS, ICON_PATHS } from '../../src/client/icons.js'
import { GROUP_COLORS, GROUP_ICONS } from '../../src/shared/constants.js'

const components = readFileSync(new URL('../../src/client/components.js', import.meta.url), 'utf8')
const plugin = readFileSync(new URL('../../src/client/plugin.js', import.meta.url), 'utf8')
const workspaceToggle = readFileSync(new URL('../../src/client/workspace-toggle.js', import.meta.url), 'utf8')

/** Source block for one CSS selector (compiled stylesheet is flat). */
const block = (selector) => {
  const start = CSS.indexOf(selector)
  assert.notEqual(start, -1, `stylesheet is missing ${selector}`)
  const end = CSS.indexOf('}', start)
  assert.notEqual(end, -1, `stylesheet selector ${selector} has no closing brace`)
  return CSS.slice(start, end + 1)
}

test('0.2.2 surfaces use official theme tokens and never hard-code white', () => {
  assert.equal(CSS.includes('--dsw-elevation-surface'), false, 'the nonexistent elevation surface token must be gone')
  assert.equal(/background:\s*#fff\b/i.test(CSS), false, 'no white surface backgrounds')
  assert.equal(CSS.includes('#f8f9fa'), false, 'no hard-coded light card color')

  assert.match(block('.dsg-menu {'), /background:\s*var\(--dsw-specific-menu/)
  assert.match(block('.dsg-search-results {'), /background:\s*var\(--dsw-specific-menu/)
  assert.match(block('.dsg-dialog {'), /background:\s*var\(--dsw-alias-bg-layer-2/)
  assert.match(block('.dsg-dialog-input {'), /background:\s*var\(--dsw-alias-bg-layer-1/)
  assert.match(block('.dsg-search-input {'), /background:\s*var\(--dsw-alias-bg-layer-1/)

  // Text/borders ride the official aliases; Canvas/CanvasText are the last
  // fallback only.
  assert.match(block('.dsg-menu {'), /color:\s*var\(--dsw-alias-label-primary,\s*CanvasText\)/)
  assert.match(block('.dsg-dialog {'), /border:[^;]*var\(--dsw-alias-border-l2/)
  assert.match(block('.dsg-search-input {'), /border:[^;]*var\(--dsw-alias-border-l3/)
})

test('header is a 36px official section row: neutral 自由分组 title and 28px actions', () => {
  const header = block('.dsg-header {')
  assert.match(header, /padding:\s*4px 8px/)
  const row = block('.dsg-header-row {')
  assert.match(row, /height:\s*28px/)

  const title = block('.dsg-header-title {')
  assert.match(title, /font-size:\s*var\(--dsg-font-14,\s*14px\)/)
  assert.match(title, /line-height:\s*20px/)
  assert.match(title, /font-weight:\s*400/)
  // Align with the shipped workspace section label; no plugin accent.
  assert.match(title, /color:\s*var\(--dsw-alias-label-secondary/)
  assert.equal(components.includes('dsg-header-accent'), false)
  assert.equal(CSS.includes('.dsg-header-accent'), false)

  const actions = block('.dsg-header-actions {')
  assert.match(actions, /gap:\s*4px/)
  for (const testId of [
    'session-groups-running-button',
    'session-groups-new-group',
    'session-groups-search-toggle',
    'session-groups-view-options',
    'session-groups-view-options-popover',
  ]) {
    assert.equal(components.includes(testId), true, `components must render ${testId}`)
  }
  const search = components.indexOf("testId: 'session-groups-search-toggle'")
  const options = components.indexOf("testId: 'session-groups-view-options'")
  const plus = components.indexOf("testId: 'session-groups-new-group'")
  assert.ok(search !== -1 && search < options && options < plus, 'header action order must be search, view-options, plus (official workspace section order)')
  // 0.2.5: the three header actions consume the official DSH artwork, not the
  // custom search/sliders/plus approximations.
  assert.match(components, /icon: 'search'/)
  assert.match(components, /icon: 'view-options'/)
  assert.match(components, /icon: 'project-add'/)
  assert.equal(components.includes("glyph: 'search'"), false)
  assert.equal(components.includes("glyph: 'sliders'"), false)
})

test('0.2.39 dialog restores the compact 0.2.30 chrome with theme tokens', () => {
  const dialog = block('.dsg-dialog {')
  assert.match(dialog, /background:\s*var\(--dsw-alias-bg-layer-2/)
  assert.match(dialog, /border:[^;]*var\(--dsw-alias-border-l2/)
  assert.match(dialog, /border-radius:\s*var\(--dsw-radius-md/)
  assert.match(dialog, /padding:\s*16px/)
  assert.match(dialog, /gap:\s*12px/)
  const confirm = block('.dsg-dialog-confirm {')
  assert.match(confirm, /background:\s*var\(--dsw-alias-button-primary-fill/)
  assert.match(confirm, /color:\s*var\(--dsw-alias-label-primary-foreground/)
  assert.match(confirm, /height:\s*32px/)
  assert.match(CSS, /\.dsg-dialog-confirm:hover:not\(:disabled\) \{ background:\s*var\(--dsw-alias-button-primary-hover/s)
  const cancel = block('.dsg-dialog-cancel {')
  assert.match(cancel, /border:[^;]*var\(--dsw-alias-border-l3/)
  assert.match(cancel, /height:\s*32px/)
  assert.match(CSS, /\.dsg-dialog-title \{[^}]*font-size:\s*var\(--dsg-font-14/s)
  assert.match(CSS, /\.dsg-dialog-actions \{[^}]*gap:\s*10px/s)
  assert.equal(CSS.includes('.dsg-dialog-close'), false)
  assert.equal(block('.dsg-dialog-backdrop {').includes('backdrop-filter'), false)
  assert.match(CSS, /\.dsg-dialog-resizer\[data-dir="se"\]::after/)
})

test('dialog natural height uses the complete flex layout', () => {
  assert.match(components, /57 \+/)
  assert.match(components, /borderHeight/)
  assert.match(components, /const laidOutHeight = Math\.ceil\(/)
  assert.match(components, /Math\.ceil\(content\?\.scrollHeight/)
  assert.match(components, /laidOutHeight \|\| Math\.ceil\(box\.height\)/)
})

test('0.2.50 dialog scroll areas use a persistent draggable thin thumb', () => {
  assert.match(CSS, /\.dsg-dialog-content \{[^}]*flex:\s*0 0 auto/s)
  assert.match(CSS, /\.dsg-dialog\[data-positioned="true"\] > \.dsg-scroll-area \{ flex:\s*1 1 auto/)
  assert.match(CSS, /\.dsg-scroll-area \{[^}]*position:\s*relative/s)
  assert.match(CSS, /\.dsg-scroll-rail \{[^}]*width:\s*5px[^}]*z-index:\s*20/s)
  assert.match(CSS, /\.dsg-scroll-thumb \{[^}]*width:\s*5px/s)
  assert.match(CSS, /\.dsg-scroll-thumb \{[^}]*background:\s*var\(--dsw-alias-scrollbar-bg-l2/)
  assert.match(CSS, /\.dsg-scroll-thumb:hover \{[^}]*--dsw-alias-scrollbar-hover-l2/s)
  assert.match(CSS, /\.dsg-scroll-thumb:hover/)
  assert.match(CSS, /\.dsg-dialog-content, \.dsg-dialog-list, \.dsg-icon-sections \{ scrollbar-width:\s*none/s)
  assert.match(CSS, /\.dsg-dialog-content::-webkit-scrollbar,[^{]*\{ width:\s*0; height:\s*0; display:\s*none; \}/s)
  assert.match(components, /const ScrollArea =/)
  assert.match(components, /class: 'dsg-scroll-rail'/)
  assert.match(components, /class: 'dsg-scroll-thumb'/)
  assert.match(components, /onPointerDown: startDrag/)
  assert.equal(CSS.includes('dsg-scroll-fade'), false)
  assert.equal(components.includes('ScrollFade'), false)
  assert.match(CSS, /\.dsg-dialog-input \{[^}]*height:\s*32px/s)
  assert.match(CSS, /\.dsg-dialog-input \{[^}]*flex:\s*none/s)
  assert.match(components, /naturalHeight/)
  assert.match(components, /content\?\.scrollHeight/)
})

test('0.2.42 top-level group destinations keep separators', () => {
  assert.match(components, /dsg-dialog-group-separator/)
  assert.match(CSS, /\.dsg-dialog-group-separator \{[^}]*border-top/s)
  assert.match(CSS, /\.dsg-dialog-list \{[^}]*z-index:\s*auto/s)
})

test('0.2.31 dialogs are draggable/resizable and backdrop clicks do not close', () => {
  assert.match(components, /dsg-dialog-titlebar/)
  assert.match(components, /dsg-dialog-resizer/)
  assert.match(components, /beginDialogGesture/)
  assert.match(components, /saveDialogGeometry/)
  assert.equal(components.includes('if (event.target === event.currentTarget) close()'), false)
  assert.match(CSS, /\.dsg-dialog\[data-positioned="true"\]/)
  assert.match(CSS, /\.dsg-dialog-titlebar \{[^}]*cursor:\s*move/s)
  assert.match(CSS, /\.dsg-dialog-resizer\[data-dir="se"\]/)
})

test('0.2.30 visible tree is memoized behind the narrow snapshot compare', () => {
  assert.match(components, /const tree = useMemo/)
  assert.match(components, /buildVisibleTree\(store\.doc, byId, workspaceItems/)
  assert.match(components, /\[store\?\.doc, store\?\.archiveFilter, byId, workspaceItems, archivedSessionIds, highlightCurrent, statuses, subagentCounts\]/)
})

test('0.2.29 status aggregation is one pass and subscriptions compare visible fields', () => {
  assert.match(components, /statusSectionsByGroup\(/)
  assert.match(components, /sessionViewEqual/)
  assert.match(components, /statusMapEqual/)
  assert.match(components, /workspaceViewEqual/)
  assert.match(components, /useMemo\(/)
  assert.equal(components.includes('runningSessionsByGroup('), false)
  assert.equal(components.includes('blockedSessionsByGroup('), false)
  assert.equal(components.includes('unreadSessionsByGroup('), false)
})

test('0.2.28 blocked and unread counters reuse the grouped dropdown contract', () => {
  assert.match(components, /statusSectionsByGroup/)
  assert.match(components, /blockedSessions/)
  assert.match(components, /unreadSessions/)
  assert.match(components, /session-groups-blocked-button/)
  assert.match(components, /session-groups-unread-button/)
  assert.match(components, /icon: 'pause'/)
  assert.match(components, /icon: 'mail'/)
  assert.match(components, /icon: 'activity'/)
  assert.match(CSS, /\.dsg-status-actions \{[^}]*margin-right:\s*28px/s)
  assert.equal(zh['blocked.empty'], '没有等待用户介入的会话')
  assert.equal(zh['unread.empty'], '没有未读会话')
})

test('0.2.27 ungrouped inbox is session-only for drops and group move menus', () => {
  assert.match(components, /ungrouped\.sessionsOnly/)
  assert.match(components, /if \(drag\.kind === 'group'\)/)
  assert.match(components, /allowRoot: dialog\.kind !== 'move-group'/)
  assert.equal(components.includes("previewGroupDrop(event, { kind: 'group-root-end' }"), false)
  assert.equal(components.includes("commitGroupDrop(drag.groupId, { kind: 'root-end' })"), false)
})

test('0.2.54 ungrouped body drop is position-aware and does not bubble invalid rows', () => {
  assert.match(components, /onDragOverUngroupedBody/)
  assert.match(components, /onDropUngroupedBody/)
  assert.match(components, /ungroupedBodyTarget/)
  assert.match(components, /sessionId !== drag\.sessionId/)
  assert.match(components, /event\.stopPropagation\(\)/)
})

test('0.3.0 beta exposes onboarding, reset layout and opaque status popovers', () => {
  assert.match(components, /session-groups-onboarding/)
  assert.match(components, /session-groups-empty-state/)
  assert.match(components, /session-groups-reset-layout/)
  assert.match(components, /session-groups-about/)
  assert.match(components, /rt\(\)\?\.debugProbe !== true/)
  assert.match(components, /readOnboardingDone/)
  assert.match(CSS, /\.dsg-onboarding \{/)
  assert.match(CSS, /\.dsg-empty-state \{/)
  assert.match(CSS, /\.dsg-running-popover \{[^}]*background:\s*var\(--dsw-alias-bg-layer-1/s)
  assert.equal(zh['onboarding.title'], '欢迎使用自由分组')
  assert.match(components, /search\.collapse/)
  assert.match(components, /glyph: 'chevronUp'/)
  assert.equal(zh['about.resetLayout'], '恢复默认显示')
  assert.match(zh['about.scope'], /不会删除或调整分组/)
  assert.match(zh['about.scope'], /会话归属/)
  assert.match(en['about.scope'], /does not delete or change groups/i)
  assert.equal(en['onboarding.title'], 'Welcome to Free groups')
})

test('0.2.26 running-session action counts all spinners and groups its menu by parent', () => {
  const runningAt = components.indexOf('session-groups-running-button')
  const toggleAt = components.indexOf("testId: 'session-groups-toggle'")
  assert.ok(runningAt > 0 && runningAt < toggleAt, 'running action must be left of the view toggle')
  assert.match(components, /statusSectionsByGroup\(/)
  assert.match(components, /session-groups-running-popover/)
  assert.match(components, /-item/)
  assert.match(components, /handlers\.openRunningSession/)
  assert.match(components, /running\.group\.ungrouped/)
  assert.match(CSS, /\.dsg-running-section \+ \.dsg-running-section[^}]*border-top/s)
  assert.match(CSS, /\.dsg-status-action \{[^}]*min-width:\s*28px/s)
  assert.equal(zh['view.title'], '自由分组')
  assert.equal(zh['running.group.ungrouped'], '未分组')
})

test('0.2.24 both views expose the header switch and share one width override', () => {
  const actionsStart = components.indexOf("class: 'dsg-header-actions'")
  const toggleAt = components.indexOf("testId: 'session-groups-toggle'", actionsStart)
  const searchAt = components.indexOf("testId: 'session-groups-search-toggle'", actionsStart)
  assert.ok(toggleAt > actionsStart)
  assert.ok(searchAt > toggleAt, 'view toggle must sit left of search')

  assert.match(components, /glyph: 'grid'/)
  assert.match(components, /data: \{ 'data-mode': store\.viewMode, 'data-target': 'workspace' \}/)
  assert.match(components, /rt\(\)\?\.toggleMode\(\)/)
  assert.match(workspaceToggle, /session-groups-workspace-toggle/)
  assert.match(workspaceToggle, /searchButton/)
  assert.match(plugin, /installWorkspaceToggle/)
  assert.match(plugin, /syncWorkspaceChrome/)
  assert.match(plugin, /applyManagedWidth/)
  assert.match(plugin, /\[data-side="sidebar"\]/)
  assert.match(components, /applyManagedWidth/)
  assert.equal(components.includes('dsg-footer-toggle'), false)
  assert.equal(CSS.includes('.dsg-footer-toggle'), false)
  assert.equal(plugin.includes('FOOTER_SLOT'), false)

  const actionButton = block('.dsg-icon-button {')
  assert.match(actionButton, /width:\s*28px/)
  assert.match(actionButton, /height:\s*28px/)
  assert.equal(UI_GLYPHS.grid.length > 0, true)
})

test('ungrouped inbox is windowed with exact spacers and bounded DOM rows', () => {
  assert.match(components, /computeVirtualWindow/)
  assert.match(components, /session-groups-virtual-spacer/)
  assert.match(components, /'data-virtual-start'/)
  assert.match(components, /'data-virtual-end'/)
  assert.match(components, /virtualRef/)
  assert.match(components, /scrollToIndex/)
  const line = block('.dsg-virtual-list {')
  assert.match(line, /gap:\s*2px/)
  assert.match(block('.dsg-virtual-spacer {'), /flex:\s*none/)
})

test('archive tri-state lives in the view-options popover with 30px rows and a check', () => {
  assert.match(components, /role: 'menuitemradio'/)
  assert.match(components, /'data-testid': 'session-groups-archive-filter'/)
  assert.match(components, /'data-filter': value/)
  assert.match(components, /'aria-checked': active \? 'true' : 'false'/)
  assert.match(components, /renderGlyph\(h, 'check', 16\)/)
  assert.match(components, /icon: 'view-options'/)
  const option = block('.dsg-view-option {')
  assert.match(option, /height:\s*30px/)
  assert.match(block('.dsg-view-options-popover {'), /position:\s*absolute/)
})

test('archive labels and footer action labels match the 0.2.4 copy', () => {
  assert.equal(zh['archive.hidden'], '隐藏已归档')
  assert.equal(zh['archive.all'], '全部对话（显示已归档）')
  assert.equal(zh['archive.only'], '仅显示已归档')
  assert.equal(en['archive.hidden'], 'Hide archived')
  assert.equal(en['archive.all'], 'All conversations (archived shown)')
  assert.equal(en['archive.only'], 'Archived only')
  // Exact footer copy requested for 0.2.4: workspace -> groups / groups -> workspace.
  assert.equal(zh['footer.toGroups'], '切换到自由分组视图')
  assert.equal(zh['footer.toWorkspace'], '返回默认工作区视图')
  assert.equal(en['footer.toGroups'], 'Switch to free grouping view')
  assert.equal(en['footer.toWorkspace'], 'Back to default workspace view')
  assert.equal(Object.hasOwn(zh, 'footer.switchLabel'), false, 'unused 0.2.2 switch label must be removed')
  assert.equal(Object.hasOwn(en, 'footer.switchLabel'), false, 'unused 0.2.2 switch label must be removed')
})

test('drag insertion uses a row-height theme-aware placeholder, not a 2px border', () => {
  const placeholder = block('.dsg-drop-placeholder {')
  assert.match(placeholder, /height:\s*var\(--dsg-drop-height,\s*32px\)/)
  assert.match(placeholder, /border:\s*1px dashed var\(--dsw-alias-state-business-primary/)
  assert.match(placeholder, /background:\s*var\(--dsw-alias-state-business-primary-fade/)
  assert.match(placeholder, /color:\s*var\(--dsw-alias-state-business-primary/)
  assert.match(placeholder, /pointer-events:\s*auto/)
  assert.match(block('.dsg-tree {'), /overflow-anchor:\s*none/, 'scroll anchoring must not cancel the placeholder gap')
  assert.match(block('.dsg-tree {'), /padding:\s*6px 8px 8px/, 'top-level left/right inset must be symmetric')
  assert.equal(CSS.includes('.dsg-drop-indicator'), false, 'the old 2px indicator must be gone')
  assert.equal(CSS.includes('.dsg-insert-before'), false, 'the old 2px before-border must be gone')
  assert.equal(CSS.includes('.dsg-insert-after'), false, 'the old 2px after-border must be gone')

  // 32px session / 34px group heights are wired from the component.
  assert.match(components, /const SESSION_PLACEHOLDER_HEIGHT = 32/)
  assert.match(components, /const GROUP_PLACEHOLDER_HEIGHT = 34/)
  assert.match(components, /'data-testid': 'session-groups-drop-indicator'/)
  assert.match(components, /'data-drop-height': String\(height\)/)
  assert.match(components, /class: 'dsg-drop-placeholder-label'/)
  // The active child slot expands from 6px to the group-row placeholder.
  const slot = block('.dsg-group-drop-slot {')
  assert.match(slot, /height:\s*6px/)
  const activeSlot = block('.dsg-group-drop-slot[data-drop-active="true"] {')
  assert.match(activeSlot, /height:\s*34px/)
  // Every drop family gets a placeholder label key.
  assert.equal(typeof zh['drag.dropHere'], 'string')
  assert.equal(typeof en['drag.dropHere'], 'string')
  assert.equal(typeof zh['drag.groupAppend'], 'string')
  assert.equal(typeof en['drag.groupAppend'], 'string')
  assert.equal(typeof zh['drag.toUngrouped'], 'string')
  assert.equal(typeof en['drag.toUngrouped'], 'string')
})

test('0.2.6 row hover actions match header controls: 28x28, 16px glyph, 4px gap, rows unchanged', () => {
  const actions = block('.dsg-group-actions, .dsg-session-actions {')
  assert.match(actions, /gap:\s*4px/)
  const actionButton = block('.dsg-group-actions .dsg-icon-button, .dsg-session-actions .dsg-icon-button {')
  assert.match(actionButton, /width:\s*28px/)
  assert.match(actionButton, /height:\s*28px/)
  // The header controls remain the reference: 28px buttons with 16px artwork.
  assert.match(block('.dsg-header-actions {'), /gap:\s*4px/)
  assert.match(block('.dsg-icon-button {'), /width:\s*28px/)
  assert.match(components, /renderGlyph\(h, glyph\)/)
  // Row heights stay 34/32 while the hit area grows.
  assert.match(block('.dsg-group-row {'), /height:\s*34px/)
  assert.match(CSS, /\.dsg-session-row \{\s*height:\s*32px/)
  // The group name/count still ellipsize (flex:1 min-width:0 / flex:none).
  assert.match(block('.dsg-group-name {'), /flex:\s*1/)
  assert.match(block('.dsg-group-name {'), /text-overflow:\s*ellipsis/)
  assert.match(block('.dsg-group-count {'), /flex:\s*none/)
})

test('0.2.7 unified guide: 16/4 content, 2px line at x=16, 60% group / 45% ungrouped', () => {
  // Group and ungrouped lists share the same rail geometry and 2px line; only
  // the color differs (group 60% mix, ungrouped label-tertiary 45%).
  const base = block('.dsg-group-line {')
  assert.match(base, /position:\s*relative/)
  assert.match(base, /margin-left:\s*16px/)
  assert.match(base, /padding-left:\s*4px/)
  assert.match(base, /border-left:\s*0/)
  const neutral = block('.dsg-group-line::before {')
  assert.match(neutral, /left:\s*-1px/)
  assert.match(neutral, /top:\s*2px/)
  assert.match(neutral, /bottom:\s*2px/)
  assert.match(neutral, /width:\s*2px/)
  assert.match(neutral, /label-tertiary[^)]*\) 45%/)
  const groupGuide = block('.dsg-group > .dsg-group-body > .dsg-group-line::before {')
  assert.match(groupGuide, /var\(--dsg-group-color[^;]*60%, transparent\)/)
  // Row padding 8 + 16px caret => caret tip x=16; guide center = margin 16 (-1 + 2/2).
  assert.match(block('.dsg-group-row {'), /padding:\s*0 8px/)
  assert.match(block('.dsg-group-caret {'), /width:\s*16px/)
  // 16px margin + 4px padding = the original 20px of content start per level.
  assert.equal(16 + 4, 20)
  // Color hierarchy: caret 85%, icon 100%, guide 60%.
  assert.match(block('.dsg-group > .dsg-group-row .dsg-group-caret {'), /var\(--dsg-group-color/)
  assert.match(block('.dsg-group > .dsg-group-row .dsg-group-caret {'), /opacity:\s*\.85/)
  assert.match(block('.dsg-group-icon {'), /color:\s*var\(--dsg-group-color/)
})

test('0.2.15 group palette: twelve distinct ids, color-token rules and a menu color dialog', () => {
  assert.deepEqual([...GROUP_COLORS], ['blue', 'green', 'orange', 'red', 'purple', 'gray', 'teal', 'pink', 'brown', 'cyan', 'navy', 'magenta'])
  for (const color of GROUP_COLORS) {
    assert.match(CSS, new RegExp(`\\.dsg-group\\[data-color="${color}"\\]`))
    assert.equal(typeof zh[`color.${color}`], 'string', `zh color.${color}`)
    assert.equal(typeof en[`color.${color}`], 'string', `en color.${color}`)
  }
  assert.equal(zh['group.color'], '修改颜色')
  assert.equal(en['group.color'], 'Change color')
  assert.equal(zh['dialog.groupColor'], '修改颜色')
  assert.equal(en['dialog.groupColor'], 'Change color')
  // Color rules drive the icon and the child guide line.
  assert.match(block('.dsg-group-icon {'), /color:\s*var\(--dsg-group-color/)
  // Menu item opens the color dialog; the dialog renders palette swatches.
  assert.match(components, /handlers\.openGroupColor\(menu\.groupId\)/)
  assert.match(components, /kind: 'group-color'/)
  assert.match(components, /'data-testid': 'session-groups-dialog-color'/)
  assert.match(components, /role: 'radiogroup'/)
  assert.match(components, /dsg-color-swatch/)
  assert.match(block('.dsg-color-swatch {'), /background:|width:\s*16px/)
  assert.match(block('.dsg-color-option[data-selected="true"] {'), /border-color:\s*var\(--dsw-alias-label-primary/)
  // The plugin applies the choice through the shared model setter.
  const plugin = readFileSync(new URL('../../src/client/plugin.js', import.meta.url), 'utf8')
  assert.match(plugin, /case 'group-color'/)
  assert.match(plugin, /setGroupColor\(latest, dialog\.groupId, payload\.color\)/)
})

test('0.2.6 selection dialogs only highlight; Confirm applies, Cancel closes unchanged', () => {
  // Initial highlight, validity and payload all come from the pure helper module.
  assert.match(components, /initialDialogSelection\(dialog, store\.doc\)/)
  assert.match(components, /selectionIsValid\(dialog, selection, store\.doc\)/)
  assert.match(components, /dialogConfirmPayload\(dialog, selection\)/)
  // Option clicks set the selection only: no direct confirm/commit calls in the
  // option handlers (the footer owns apply).
  assert.equal(components.includes('onClick: () => confirm({'), false)
  assert.equal(components.includes('onPick: (groupId)'), false)
  assert.equal((components.match(/setSelection\(/g) ?? []).length >= 4, true)
  // Footer is rendered for every dialog kind and disabled without a valid value.
  assert.match(components, /class: 'dsg-dialog-confirm'/)
  assert.match(components, /disabled: !canConfirm/)
  assert.match(components, /class: 'dsg-dialog-cancel'/)
  // Every selection dialog exposes a stable test id + ARIA state.
  for (const testId of [
    'session-groups-dialog-workspace',
    'session-groups-dialog-group',
    'session-groups-dialog-icon',
    'session-groups-dialog-color',
  ]) {
    assert.equal(components.includes(testId), true, `missing ${testId}`)
  }
  assert.match(components, /'aria-selected': active \? 'true' : 'false'/)
  assert.match(components, /'aria-checked': active \? 'true' : 'false'/)
  // Input/delete/archive dialogs keep their existing behavior.
  assert.match(components, /needsInput \? \{ value: value\.trim\(\) \}/)
  assert.match(components, /t\('dialog\.stopAndArchive'\)/)
})

test('0.2.11 row order: title → workspace → actions → archived → time', () => {
  const name = components.indexOf("class: 'dsg-group-name'")
  const actions = components.indexOf("class: 'dsg-group-actions'", name)
  const count = components.indexOf("class: 'dsg-group-count'", actions)
  assert.ok(name !== -1 && actions !== -1 && count !== -1 && name < actions && actions < count)
  assert.ok(components.includes("'data-testid': 'session-groups-group-count'"))
  const title = components.indexOf("class: 'dsg-session-title'")
  const workspace = components.indexOf("class: 'dsg-workspace-badge'", title)
  const sessionActions = components.indexOf("class: 'dsg-session-actions'", workspace)
  const badge = components.indexOf("class: 'dsg-session-badge'", sessionActions)
  const time = components.indexOf("class: 'dsg-session-time'", badge)
  assert.ok(title !== -1 && workspace !== -1 && sessionActions !== -1 && badge !== -1 && time !== -1)
  assert.ok(title < workspace && workspace < sessionActions && sessionActions < badge && badge < time)
  assert.ok(components.includes("'data-testid': 'session-groups-session-time'"))

  // Count always visible, tabular 12/16, right-aligned at the 8px row padding.
  const countCss = block('.dsg-group-count {')
  assert.match(countCss, /text-align:\s*right/)
  assert.match(countCss, /font-size:\s*var\(--dsg-font-12,\s*12px\)/)
  assert.match(countCss, /line-height:\s*16px/)
  assert.match(countCss, /font-variant-numeric:\s*tabular-nums/)
  // 0.2.8: official trailing type is 10/16, 40px minimum, right-aligned.
  const timeCss = block('.dsg-session-time {')
  assert.match(timeCss, /min-width:\s*40px/)
  assert.match(timeCss, /text-align:\s*right/)
  assert.match(timeCss, /font-size:\s*var\(--dsg-font-10,\s*10px\)/)
  assert.match(timeCss, /line-height:\s*16px/)
  assert.match(timeCss, /tabular-nums/)
  // Actions are invisible *and* non-interactive until hover/focus.
  const actionsCss = block('.dsg-group-actions, .dsg-session-actions {')
  assert.match(actionsCss, /opacity:\s*0/)
  assert.match(actionsCss, /pointer-events:\s*none/)
  const reveal = block('.dsg-group-row:hover .dsg-group-actions, .dsg-group-row:focus-within .dsg-group-actions,')
  assert.match(CSS, /\.dsg-session-row:hover \.dsg-session-actions[^}]*pointer-events:\s*auto/s)
  assert.match(reveal, /opacity:\s*1/)
  // Row focus ring.
  assert.match(CSS, /\.dsg-group-row:focus-visible, \.dsg-session-row:focus-visible \{[^}]*outline:\s*2px/s)
  // The applied-width flag hides the workspace badge at the narrow minimum.
  assert.match(CSS, /\.dsg-root\[data-narrow="true"\] \.dsg-workspace-badge \{ display: none; \}/)
  assert.match(components, /'data-narrow': appliedWidth !== null && appliedWidth <= 320/)
})

test('0.2.8 session status: official 16x20 slot, spinner, dots, hidden labels and compact trailing', () => {
  const slot = block('.dsg-session-status {')
  assert.match(slot, /width:\s*16px/)
  assert.match(slot, /height:\s*20px/)
  assert.match(slot, /flex:\s*none/)
  assert.match(components, /class: 'dsg-session-status'/)
  assert.match(components, /testId = 'session-groups-session-status'/)
  // Idle/archived/blank only paint an empty slot; no transparent dot class remains.
  assert.equal(CSS.includes('.dsg-session-dot'), false, 'the 0.2.7 6px dot must be gone')
  assert.match(components, /const show = primary !== null && primary\.state !== 'idle'/)
  assert.match(components, /hidden = false/)
  assert.match(components, /hiddenStatus = archived \|\| row\.blank === true/)
  // Official 14px spinner: two r=9.5 circles in a 24 viewBox.
  assert.match(components, /class: 'dsg-status-spinner'/)
  assert.match(components, /width: '14'/)
  assert.match(components, /height: '14'/)
  assert.match(components, /viewBox: '0 0 24 24'/)
  assert.equal((components.match(/r: '9\.5'/g) ?? []).length, 2)
  assert.match(components, /class: 'dsg-status-spinner-track'/)
  assert.match(components, /class: 'dsg-status-spinner-arc'/)
  const spinner = block('.dsg-status-spinner-motion {')
  assert.match(spinner, /animation:\s*dsg-state-dot-spin 1\.5s linear infinite/)
  assert.match(CSS, /\.dsg-status-spinner-arc \{ stroke-dasharray:\s*12 150;/)
  assert.match(CSS, /\.dsg-status-spinner-arc \{[^}]*animation:\s*dsg-state-dot-dash 1\.5s ease-in-out infinite/)
  assert.match(CSS, /stroke-width:\s*2/)
  assert.match(block('.dsg-status-spinner-track {'), /opacity:\s*\.25/)
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\) \{\s*\.dsg-status-spinner-motion, \.dsg-status-spinner-arc \{ animation: none; \}/)
  // 10px dot with 6px core (inset 20%) and official warn/success aliases.
  assert.match(block('.dsg-status-dot {'), /width:\s*10px/)
  assert.match(block('.dsg-status-dot {'), /height:\s*10px/)
  assert.match(block('.dsg-status-dot::after {'), /inset:\s*20%/)
  assert.match(CSS, /--dsw-alias-state-warn-primary/)
  assert.match(CSS, /--dsw-alias-state-success-primary/)
  // Pending swaps the trailing time cell for the compact locale label.
  assert.match(components, /primaryStatus\.compactKey/)
  assert.match(components, /'data-compact-status': primaryStatus\.pendingKind/)
  assert.match(components, /dsg-session-compact-status/)
  // Visually hidden labels carry every displayed status (including subagents).
  assert.match(block('.dsg-visually-hidden {'), /clip:\s*rect\(0 0 0 0\)/)
  assert.match(components, /class: 'dsg-visually-hidden'/)
  assert.match(components, /statusText\(status\)/)
})

test('0.2.8 empty drop box matches DropPlaceholder and never doubles a body placeholder', () => {
  const box = block('.dsg-empty-dropbox {')
  assert.match(box, /box-sizing:\s*border-box/)
  assert.match(box, /display:\s*flex/)
  assert.match(box, /align-items:\s*center/)
  assert.match(box, /justify-content:\s*center/)
  assert.match(box, /width:\s*100%/)
  assert.match(box, /min-width:\s*0/)
  assert.match(box, /min-height:\s*32px/)
  assert.match(box, /padding:\s*0 8px/)
  assert.match(box, /border:\s*1px dashed/)
  assert.match(box, /border-radius:\s*6px/)
  assert.match(box, /font-size:\s*var\(--dsg-font-12,\s*12px\)/)
  const active = block('.dsg-empty-dropbox[data-drop-active="true"] {')
  assert.match(active, /border-color:\s*var\(--dsw-alias-state-business-primary/)
  assert.match(active, /background:\s*var\(--dsw-alias-state-business-primary-fade/)
  assert.match(active, /color:\s*var\(--dsw-alias-state-business-primary/)
  assert.match(components, /class: 'dsg-empty-dropbox'/)
  assert.match(components, /class: 'dsg-empty-dropbox-plus'/)
  assert.match(components, /renderGlyph\(h, 'plus', 14\)/)
  assert.match(components, /class: 'dsg-empty-dropbox-label'/)
  // The old left-aligned italic plain hint is gone.
  assert.equal(components.includes('dsg-group-empty'), false)
  assert.equal(CSS.includes('.dsg-group-empty'), false)
  // Body placeholders suppress the hint; boundary targets keep its accent state.
  assert.match(components, /bodyPlaceholderVisible/)
  assert.match(components, /node\.visibleCount === 0 && childGroups\.length === 0 && !bodyPlaceholderVisible/)
  assert.match(components, /dropKind !== 'ungrouped'/)
})

test('0.2.14 color dialog: 2x3 roomy grid, fixed check slot, custom native+hex row', () => {
  const grid = block('.dsg-color-grid {')
  assert.match(grid, /display:\s*grid/)
  assert.match(grid, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(grid, /padding:\s*8px/)
  assert.match(grid, /background:\s*var\(--dsw-alias-bg-layer-1/)
  assert.match(grid, /border:[^;]*var\(--dsw-alias-border-l3/)
  const option = block('.dsg-color-option {')
  assert.match(option, /height:\s*36px/)
  assert.match(option, /width:\s*100%/)
  // Every preset cell renders a check node; unselected cells hide (not remove) it.
  assert.match(components, /'data-testid': 'session-groups-dialog-color-check'/)
  assert.match(components, /'data-empty': active \? 'false' : 'true'/)
  assert.match(components, /visibility: active \? 'visible' : 'hidden'/)
  assert.match(block('.dsg-dialog-option-check {'), /width:\s*16px/)
  assert.match(block('.dsg-dialog-option-check {'), /flex:\s*none/)
  // Custom row: native color swatch + 7-char hex input + aria-live hint.
  assert.match(components, /type: 'color'/)
  assert.match(components, /'data-testid': 'session-groups-dialog-color-native'/)
  assert.match(components, /'data-testid': 'session-groups-dialog-color-hex'/)
  assert.match(components, /maxlength: '7'/)
  assert.match(components, /'aria-live': 'polite'/)
  assert.match(components, /'data-testid': 'session-groups-dialog-color-hint'/)
  assert.match(components, /normalizeColorHex\(raw\)/)
  assert.match(components, /setHexInput\(''\)/)
  assert.match(block('.dsg-color-custom-row {'), /height:\s*32px/)
  assert.match(block('.dsg-color-hex {'), /flex:\s*1/)
  assert.match(block('.dsg-color-hint {'), /font-size:\s*var\(--dsg-font-11,\s*11px\)/)
})

test('0.2.7 hash default icon and custom color precedence helpers', () => {
  assert.equal(GROUP_ICONS.includes('hash'), true)
  assert.equal(typeof ICON_PATHS.hash, 'object')
  const colorCore = readFileSync(new URL('../../src/core/color.js', import.meta.url), 'utf8')
  assert.match(colorCore, /groupColorHex\(group\) \?\? `var\(--dsg-color-\$\{groupColor\(group\)\}\)`/)
  assert.match(components, /style: \{ '--dsg-group-color': groupColorCss\(group\) \}/)
  // The host stores the custom hex alongside the legacy palette id.
  const plugin = readFileSync(new URL('../../src/client/plugin.js', import.meta.url), 'utf8')
  assert.match(plugin, /setGroupColorHex\(latest, dialog\.groupId, payload\.colorHex\)/)
})

test('0.2.7 right-click/keyboard menu wiring and clamped anchors', () => {
  assert.match(components, /onContextMenu: \(event\) => handlers\.onGroupContextMenu/)
  assert.match(components, /onContextMenu: \(event\) => handlers\.onSessionContextMenu/)
  assert.match(components, /'aria-haspopup': 'menu'/)
  assert.match(components, /menuAnchorFromEvent/)
  assert.match(components, /menuAnchorFromRow/)
  assert.match(components, /isMenuKey\(event\)/)
  assert.match(components, /if \(dragRef\.current\) return/)
  // The mounted menu re-clamps with its real rect.
  assert.match(components, /clampMenuPosition\(\{/)
  const plugin = readFileSync(new URL('../../src/client/plugin.js', import.meta.url), 'utf8')
  assert.match(plugin, /'scroll', closeMenuOnViewportChange, true/)
  assert.match(plugin, /'resize', closeMenuOnViewportChange/)
})


test('0.2.9 delete group: destination picker, empty direct path and move-and-delete footer', () => {
  // Group menu keeps the delete entry and the color entry now says 修改颜色/Change color.
  assert.match(components, /t\('group\.delete'\)/)
  assert.match(components, /t\('group\.color'\)/)
  assert.equal(zh['group.color'], '修改颜色')
  assert.equal(en['group.color'], 'Change color')
  // Non-empty delete dialog: 删除分组 title, counts, destination list and root option.
  assert.match(components, /kind: 'delete-group'/)
  assert.match(components, /titleKey: 'dialog\.deleteGroup'/)
  assert.match(components, /t\('dialog\.deleteMoveBody'/)
  assert.match(components, /session-groups-dialog-delete-body/)
  assert.match(components, /deleteGroupOptions\(store\.doc, dialog\.groupId\)/)
  assert.match(components, /rootLabel: t\('dialog\.rootDestination'\)/)
  assert.match(components, /session-groups-dialog-delete-options/)
  // Footer is danger-styled and says 移动并删除 / Move and delete only for this dialog.
  assert.match(components, /dialog\.kind === 'delete-group' \? t\('dialog\.moveAndDelete'\)/)
  assert.equal(zh['dialog.moveAndDelete'], '移动并删除')
  assert.equal(en['dialog.moveAndDelete'], 'Move and delete')
  assert.match(components, /data-variant': danger \? 'danger' : 'primary'/)
  // Empty leaf: no dialog, direct runtime commit + toast.
  assert.match(components, /deleteGroupNeedsDialog\(store\.doc, groupId\)/)
  assert.match(components, /deleteGroupDirect\?\.\(groupId\)/)
  const plugin = readFileSync(new URL('../../src/client/plugin.js', import.meta.url), 'utf8')
  assert.match(plugin, /const deleteGroupDirect = async \(groupId\)/)
  assert.match(plugin, /'toast\.groupDeleted'/)
  assert.match(plugin, /deleteGroupTo\(latest, dialog\.groupId, payload\.destinationId \?\? null\)/)
  assert.match(plugin, /deleteGroupDirect,/)
  // A destination is mandatory before Confirm: no initial highlight for delete.
  assert.equal(components.includes("t('dialog.deleteBody'"), false)
})

test('0.2.11 dialog hover/focus affordances', () => {
  assert.match(CSS, /\.dsg-dialog-option:hover\s*\{/)
  assert.match(CSS, /\.dsg-dialog-option\[aria-selected="true"\]:hover/)
  assert.match(CSS, /\.dsg-dialog-cancel:hover\s*\{/)
  assert.match(CSS, /\.dsg-dialog-confirm:hover:not\(:disabled\)/)
  assert.match(CSS, /\.dsg-dialog-confirm\[data-variant="danger"\]:hover:not\(:disabled\)/)
  assert.match(CSS, /\.dsg-color-option:hover\s*\{/)
  assert.match(CSS, /\.dsg-color-option\[data-selected="true"\]:hover/)
  assert.match(CSS, /\.dsg-dialog-option:focus-visible/)
})

test('0.2.13 active row, official session watermark and semantic icon sections', () => {
  assert.equal(SESSION_WATERMARK_BASE, 5)
  assert.equal(SESSION_WATERMARK_AUTO_MAX, 50)
  assert.match(components, /mainSessionIdOf\(sessions\)/)
  assert.match(CSS, /\.dsg-session-row\[data-current="true"\][^}]*inset 2px 0 0/)
  assert.match(CSS, /\.dsg-session-row\[data-current="true"\] \.dsg-session-title/)
  assert.match(components, /showSessionOverflow/)
  assert.match(components, /setSessionWatermark/)
  assert.match(components, /session-groups-session-overflow/)
  assert.match(CSS, /\.dsg-session-overflow\s*\{/)
  assert.match(CSS, /\.dsg-session-overflow:hover/)
  assert.equal(zh['sessions.expand'], '展开其余 {n} 个会话')
  assert.equal(zh['sessions.collapse'], '收起')
  const icons = ICON_GROUPS.flatMap((group) => group.icons)
  for (const icon of ['check-circle', 'check', 'x-circle', 'x', 'pause-circle', 'pause', 'play-circle', 'play', 'stop-circle', 'stop', 'ban']) {
    assert.ok(icons.includes(icon), `missing semantic icon ${icon}`)
  }
  assert.ok(ICON_GROUPS.length >= 6)
  assert.ok(GROUP_ICONS.length >= 70)
  assert.match(CSS, /\.dsg-icon-section-title/)
  assert.match(CSS, /\.dsg-icon-section \+ \.dsg-icon-section/)
})

test('0.2.14 dialog options use roomy padding and standard depth indent', () => {
  const option = CSS.slice(CSS.indexOf('.dsg-dialog-option {'), CSS.indexOf('.dsg-dialog-option {') + 260)
  assert.match(option, /min-height:\s*36px/)
  assert.match(option, /padding:\s*6px 12px/)
  const footer = CSS.slice(CSS.indexOf('.dsg-dialog-confirm {'), CSS.indexOf('.dsg-dialog-confirm {') + 260)
  assert.match(footer, /height:\s*32px/)
  assert.match(footer, /padding:\s*0 16px/)
  assert.match(components, /paddingLeft:\s*`\$\{12 \+ depth \* 16\}px`/)
  assert.match(CSS, /\.dsg-dialog-list \{[^}]*padding:\s*8px/s)
  assert.match(CSS, /\.dsg-color-option \{[^}]*height:\s*36px/s)
})

test('0.3.0-beta.3 move dialogs insert at the target group head', () => {
  const plugin = readFileSync(new URL('../../src/client/plugin.js', import.meta.url), 'utf8')
  assert.match(plugin, /actions\.moveSession\(dialog\.sessionId, payload\.groupId \?\? null, 0\)/)
  assert.match(plugin, /moveGroup\(latest, dialog\.groupId, payload\.groupId \?\? null, 0\)/)
})

test('0.3.0-beta.2 drag floating labels are localized', () => {
  assert.match(components, /t\('drag\.sessionIntoGroup'/)
  assert.match(components, /t\('drag\.sessionOut'\)/)
  assert.equal(components.includes('放入『'), false)
  assert.equal(components.includes('移出分组'), false)
  assert.equal(zh['drag.sessionIntoGroup'], '放入『{name}』')
  assert.equal(en['drag.sessionIntoGroup'], 'Drop into “{name}”')
  assert.equal(zh['drag.sessionOut'], '移出分组')
  assert.equal(en['drag.sessionOut'], 'Remove from group')
})

test('0.2.23 row-boundary dragleave keeps the placeholder while inside the sidebar', () => {
  assert.match(components, /const pointerOutsideRoot = \(event\) =>/)
  assert.match(components, /if \(!pointerOutsideRoot\(event\)\) return/)
  assert.match(components, /visible flicker/)
})

test('0.2.22 group-body gaps do not become group-head drop targets', () => {
  assert.match(components, /querySelector\?\.\('\[data-session-id\]'\)/)
  assert.match(components, /event\.clientY >= firstRect\.top/)
  assert.match(components, /next\.closest\('\.dsg-group-line'\)/)
})

test('0.2.20 session rows are memoized behind a stable handler facade', () => {
  assert.match(components, /const SessionRow = memo\(SessionRowImpl, sessionRowPropsEqual\)/)
  assert.match(components, /const stableHandlers = useMemo\(/)
  assert.match(components, /new Proxy\(/)
  assert.match(components, /handlersRef\.current\?\.\[property\]/)
  assert.match(components, /handlers: stableHandlers, sessionsById: byId/)
  assert.match(components, /handlers: stableHandlers, virtualRef/)
})

test('0.2.19 active-session highlight receives the live view store', () => {
  const calls = components.split('\n').filter((line) => line.includes('h(SessionRow, {'))
  assert.equal(calls.length, 2)
  for (const call of calls) assert.match(call, /\bstore\b/)
})

test('0.2.16 icon set covers devices/actions', () => {
  for (const icon of ['computer', 'phone', 'mail', 'log', 'cpu', 'memory', 'hard-drive', 'server', 'network', 'camera', 'music', 'video', 'wifi', 'map', 'gift']) {
    assert.ok(GROUP_ICONS.includes(icon), `missing icon ${icon}`)
  }
  assert.equal(zh['icon.computer'], '电脑')
  assert.equal(zh['icon.phone'], '手机')
  assert.equal(zh['icon.mail'], '邮箱')
  assert.equal(zh['iconGroup.devices'], '设备')
})
