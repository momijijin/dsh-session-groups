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
import { UI_GLYPHS } from '../../src/client/icons.js'

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

test('header is a 36px official section row: title 14/20 primary + accent icon, three 28px actions', () => {
  const header = block('.dsg-header {')
  assert.match(header, /padding:\s*4px 4px 4px 2px/)
  const row = block('.dsg-header-row {')
  assert.match(row, /height:\s*28px/)

  const title = block('.dsg-header-title {')
  assert.match(title, /font-size:\s*var\(--dsg-font-14,\s*14px\)/)
  assert.match(title, /line-height:\s*20px/)
  assert.match(title, /color:\s*var\(--dsw-alias-label-primary/)

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
  assert.match(components, /glyph: 'sliders'/)
  const option = block('.dsg-view-option {')
  assert.match(option, /height:\s*30px/)
  assert.match(block('.dsg-view-options-popover {'), /position:\s*absolute/)
})

test('archive labels and footer action labels match the 0.2.3 copy', () => {
  assert.equal(zh['archive.hidden'], '隐藏已归档')
  assert.equal(zh['archive.all'], '全部对话（显示已归档）')
  assert.equal(zh['archive.only'], '仅显示已归档')
  assert.equal(en['archive.hidden'], 'Hide archived')
  assert.equal(en['archive.all'], 'All conversations (archived shown)')
  assert.equal(en['archive.only'], 'Archived only')
  assert.equal(zh['footer.toGroups'], '分组视图')
  assert.equal(zh['footer.toWorkspace'], '工作区视图')
  assert.equal(Object.hasOwn(zh, 'footer.switchLabel'), false, 'unused 0.2.2 switch label must be removed')
  assert.equal(Object.hasOwn(en, 'footer.switchLabel'), false, 'unused 0.2.2 switch label must be removed')
})
