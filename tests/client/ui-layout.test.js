// tests/client/ui-layout.test.js
//
// 0.2.2 UI-layout contract: footer two-segment switch, theme-aware surfaces,
// header action order and the view-options archive menu. Pure source/CSS
// assertions keep the host-DOM details covered by E2E step 1/2/16/17.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { CSS } from '../../src/client/css.js'
import { en, zh } from '../../src/client/locale.js'
import { UI_GLYPHS, ICON_PATHS } from '../../src/client/icons.js'
import { GROUP_COLORS, GROUP_ICONS } from '../../src/shared/constants.js'

const components = readFileSync(new URL('../../src/client/components.js', import.meta.url), 'utf8')

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

test('header is a 36px official section row: title 14/20 weight 400 + accent icon, three 28px actions', () => {
  const header = block('.dsg-header {')
  assert.match(header, /padding:\s*4px 4px 4px 2px/)
  const row = block('.dsg-header-row {')
  assert.match(row, /height:\s*28px/)

  const title = block('.dsg-header-title {')
  assert.match(title, /font-size:\s*var\(--dsg-font-14,\s*14px\)/)
  assert.match(title, /line-height:\s*20px/)
  assert.match(title, /font-weight:\s*400/)
  // 0.2.6 (feedback item 1): the title text and its icon share the primary accent.
  assert.match(title, /color:\s*var\(--dsw-alias-state-business-primary/)

  const accent = block('.dsg-header-accent {')
  assert.match(accent, /width:\s*16px/)
  assert.match(accent, /height:\s*16px/)
  assert.match(accent, /color:\s*var\(--dsw-alias-state-business-primary/)

  const actions = block('.dsg-header-actions {')
  assert.match(actions, /gap:\s*4px/)
  for (const testId of [
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

test('footer is one 28px toggle button whose icon/label target the other view', () => {
  const toggle = block('.dsg-footer-toggle {')
  assert.match(toggle, /height:\s*28px/)
  assert.match(toggle, /font-size:\s*var\(--dsg-font-13,\s*13px\)/)
  assert.match(toggle, /gap:\s*6px/)

  assert.match(components, /class: 'dsg-footer-toggle'/)
  assert.match(components, /'data-testid': 'session-groups-toggle'/)
  assert.match(components, /'data-mode': mode/)
  assert.match(components, /'aria-pressed': mode === 'groups' \? 'true' : 'false'/)
  assert.match(components, /const target = mode === 'groups' \? 'workspace' : 'groups'/)
  assert.match(components, /const glyph = target === 'groups' \? 'folderAdjust' : 'grid'/)
  assert.match(components, /rt\(\)\?\.toggleMode\(\)/)
  assert.equal(components.includes('dsg-footer-segment'), false, 'the 0.2.2 two-segment switch must be gone')
  assert.equal(components.includes('dsg-footer-switch'), false, 'the 0.2.2 switch track must be gone')
  assert.equal(CSS.includes('.dsg-footer-segment'), false, 'no segment CSS remains')
  assert.equal(CSS.includes('.dsg-footer-switch'), false, 'no switch-track CSS remains')
  assert.equal(UI_GLYPHS.grid.length > 0, true)
  assert.equal(UI_GLYPHS.folderAdjust.length > 0, true)
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

test('0.2.6 group palette: six ids, color-token rules and a menu color dialog', () => {
  assert.deepEqual([...GROUP_COLORS], ['blue', 'green', 'orange', 'red', 'purple', 'gray'])
  for (const color of GROUP_COLORS) {
    assert.match(CSS, new RegExp(`\\.dsg-group\\[data-color="${color}"\\]`))
    assert.equal(typeof zh[`color.${color}`], 'string', `zh color.${color}`)
    assert.equal(typeof en[`color.${color}`], 'string', `en color.${color}`)
  }
  assert.equal(zh['group.color'], '颜色')
  assert.equal(en['group.color'], 'Color')
  assert.equal(zh['dialog.groupColor'], '分组颜色')
  assert.equal(en['dialog.groupColor'], 'Group color')
  // Color rules drive the icon and the child guide line.
  assert.match(block('.dsg-group-icon {'), /color:\s*var\(--dsg-group-color/)
  // Menu item opens the color dialog; the dialog renders palette swatches.
  assert.match(components, /handlers\.openGroupColor\(menu\.groupId\)/)
  assert.match(components, /kind: 'group-color'/)
  assert.match(components, /'data-testid': 'session-groups-dialog-color'/)
  assert.match(components, /role: 'radiogroup'/)
  assert.match(components, /dsg-color-swatch/)
  assert.match(block('.dsg-color-swatch {'), /background:|width:\s*16px/)
  assert.match(block('.dsg-color-option[data-selected="true"] {'), /border-color:\s*var\(--dsw-alias-state-business-primary/)
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

test('0.2.7 row order: group count far right, session time far right, hidden action hit areas', () => {
  const name = components.indexOf("class: 'dsg-group-name'")
  const actions = components.indexOf("class: 'dsg-group-actions'", name)
  const count = components.indexOf("class: 'dsg-group-count'", actions)
  assert.ok(name !== -1 && actions !== -1 && count !== -1 && name < actions && actions < count)
  assert.ok(components.includes("'data-testid': 'session-groups-group-count'"))
  const sessionActions = components.indexOf("class: 'dsg-session-actions'")
  const sessionTime = components.indexOf("class: 'dsg-session-time'", sessionActions)
  assert.ok(sessionActions !== -1 && sessionTime !== -1 && sessionActions < sessionTime)
  assert.ok(components.includes("'data-testid': 'session-groups-session-time'"))

  // Count always visible, tabular 12/16, right-aligned at the 8px row padding.
  const countCss = block('.dsg-group-count {')
  assert.match(countCss, /text-align:\s*right/)
  assert.match(countCss, /font-size:\s*var\(--dsg-font-12,\s*12px\)/)
  assert.match(countCss, /line-height:\s*16px/)
  assert.match(countCss, /font-variant-numeric:\s*tabular-nums/)
  // Time: 12/16, 40px minimum, right-aligned.
  const timeCss = block('.dsg-session-time {')
  assert.match(timeCss, /min-width:\s*40px/)
  assert.match(timeCss, /text-align:\s*right/)
  assert.match(timeCss, /font-size:\s*var\(--dsg-font-12,\s*12px\)/)
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

test('0.2.7 color dialog: 2x3 32px grid, fixed check slot, custom native+hex row', () => {
  const grid = block('.dsg-color-grid {')
  assert.match(grid, /display:\s*grid/)
  assert.match(grid, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/)
  const option = block('.dsg-color-option {')
  assert.match(option, /height:\s*32px/)
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
  assert.match(components, /groupColorHex\(group\) \?\? `var\(--dsg-color-\$\{groupColor\(group\)\}\)`/)
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
