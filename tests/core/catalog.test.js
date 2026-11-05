import test from 'node:test'
import assert from 'node:assert/strict'
import { buildControlCatalog } from '../../src/core/catalog.js'
import { CONTROL_OPERATIONS } from '../../src/core/control.js'
import {
  COLOR_CATALOG,
  COLOR_FORMATS,
  CONTROL_LIMITS,
  ICON_CATALOG,
  ICON_GROUPS,
  ICON_STYLE,
} from '../../src/shared/control-catalog.js'
import { GROUP_COLORS, GROUP_COLOR_HEX, GROUP_ICONS } from '../../src/shared/constants.js'
import { ICON_GROUPS as CLIENT_ICON_GROUPS } from '../../src/client/icons.js'
import { en, zh } from '../../src/client/locale.js'

test('icon categories cover the contract icon set exactly once', () => {
  const ids = ICON_GROUPS.flatMap((group) => group.icons)
  assert.deepEqual([...ids].sort(), [...GROUP_ICONS].sort())
  assert.equal(ids.length, GROUP_ICONS.length)
  assert.equal(new Set(ids).size, ids.length, 'icon ids must be unique across categories')

  const categoryKeys = new Set(ICON_GROUPS.map((group) => group.key))
  assert.equal(categoryKeys.size, ICON_GROUPS.length, 'category keys must be unique')
  for (const group of ICON_GROUPS) {
    assert.ok(group.key.length > 0)
    assert.ok(group.icons.length > 0, `${group.key} must not be empty`)
    assert.equal(typeof group.labelKey, 'string')
  }
  for (const item of ICON_CATALOG) {
    assert.equal(categoryKeys.has(item.category), true, `${item.id}: unknown category`)
    assert.equal(item.style, ICON_STYLE)
    assert.equal(item.labelKey, `icon.${item.id}`)
  }
  assert.deepEqual(ICON_GROUPS, CLIENT_ICON_GROUPS, 'client must consume the shared category source')
})

test('icon and color labels resolve in both shipped locales', () => {
  for (const item of [...ICON_CATALOG, ...COLOR_CATALOG]) {
    assert.equal(typeof en[item.labelKey], 'string', `en missing ${item.labelKey}`)
    assert.equal(typeof zh[item.labelKey], 'string', `zh missing ${item.labelKey}`)
  }
  for (const group of ICON_GROUPS) {
    assert.equal(typeof en[group.labelKey], 'string', `en missing ${group.labelKey}`)
    assert.equal(typeof zh[group.labelKey], 'string', `zh missing ${group.labelKey}`)
  }
})

test('color catalog matches the shared palette and documents the custom format', () => {
  assert.equal(COLOR_CATALOG.length, GROUP_COLORS.length)
  assert.deepEqual(COLOR_CATALOG.map((item) => item.id), [...GROUP_COLORS])
  for (const item of COLOR_CATALOG) {
    assert.equal(item.hex, GROUP_COLOR_HEX[item.id])
    assert.match(item.hex, /^#[0-9a-f]{6}$/)
    assert.equal(item.labelKey, `color.${item.id}`)
  }
  assert.deepEqual([...COLOR_FORMATS.palette.values], [...GROUP_COLORS])
  assert.deepEqual([...COLOR_FORMATS.custom.input], ['#RGB', 'RGB', '#RRGGBB', 'RRGGBB'])
  assert.equal(COLOR_FORMATS.custom.canonical, '#rrggbb')
  assert.equal(COLOR_FORMATS.custom.alpha, false)
  assert.equal(COLOR_FORMATS.custom.maxLength, 7)
  assert.equal(CONTROL_LIMITS.iconCount, GROUP_ICONS.length)
  assert.equal(CONTROL_LIMITS.colorCount, GROUP_COLORS.length)
})

test('control catalog is additive, stable and exposes operation names', () => {
  const catalog = buildControlCatalog()
  assert.equal(catalog.protocol, 1)
  assert.deepEqual(catalog.operations, [...CONTROL_OPERATIONS])
  assert.equal(catalog.icons.items.length, GROUP_ICONS.length)
  assert.deepEqual(catalog.icons.categories.map((entry) => entry.key), ICON_GROUPS.map((entry) => entry.key))
  assert.equal(catalog.colors.items.length, GROUP_COLORS.length)
  assert.equal(catalog.colors.formats.custom.canonical, '#rrggbb')
  assert.equal(catalog.limits.maxGroupNameLength > 0, true)
  // A fresh array each call prevents callers from mutating the frozen source.
  assert.notEqual(catalog.icons.items, buildControlCatalog().icons.items)
})
