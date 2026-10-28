/**
 * Fixed 16px inline SVG icon set (V1: no host icon dependency, no uploads, no
 * colors). Paths are stroke-only so they inherit `currentColor` and work in both
 * DSH themes.
 */
import { DEFAULT_ICON, GROUP_ICONS } from '../shared/constants.js'

/** SVG path data per contract icon name (viewBox 0 0 16 16). */
export const ICON_PATHS = Object.freeze({
  folder: ['M2.5 5.1h3.6l1.4 1.7h6v6.1h-11z', 'M2.5 5.1V3.9h3.6l1.4 1.2h4.6v1.7'],
  'folder-open': ['M2.5 5.1h3.6l1.4 1.7h5.2l-1.2 5.2h-9z', 'M2.5 5.1V3.9h3.6l1.4 1.2h4.4v1.4'],
  star: ['M8 2.2l1.73 3.5 3.87.56-2.8 2.73.66 3.85L8 11.02l-3.46 1.82.66-3.85-2.8-2.73 3.87-.56z'],
  flag: ['M4.2 2.6v11', 'M4.2 3.1h8.1l-1.7 2.6 1.7 2.5H4.2z'],
  bookmark: ['M4.2 2.6h7.6v11l-3.8-2.5-3.8 2.5z'],
  tag: ['M2.6 2.9h4.9l5.6 5.6-4.2 4.2-5.6-5.6z', 'M5.1 5.3h.01'],
  bulb: ['M8 2.4a3.6 3.6 0 0 1 2.1 6.5V11H5.9v-2.1A3.6 3.6 0 0 1 8 2.4z', 'M6.4 12.6h3.2'],
  rocket: ['M8 1.9c2.6 1.1 4.1 3.3 4.1 6.2l-2.1 3H6l-2.1-3c0-2.9 1.5-5.1 4.1-6.2z', 'M6 11.1l-2 3.2 3-1.1', 'M10 11.1l2 3.2-3-1.1', 'M8 4.2v3.2'],
})

/** All icon names the plugin accepts (contract set). */
export const ICON_NAMES = GROUP_ICONS

/** Resolve a possibly-invalid icon name to the default folder. */
export const iconName = (name) => (GROUP_ICONS.includes(name) ? name : DEFAULT_ICON)

/**
 * Render one icon as a React element.
 * @param {(type: string, props?: object, ...children: any[]) => any} h React createElement
 * @param {string} name contract icon name
 * @param {number} [size] rendered square size (default 16)
 */
export const renderIcon = (h, name, size = 16) => {
  const resolved = iconName(name)
  const paths = ICON_PATHS[resolved] ?? ICON_PATHS[DEFAULT_ICON]
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      'aria-hidden': 'true',
      focusable: 'false',
      class: 'dsg-icon',
    },
    ...paths.map((d, index) =>
      h('path', {
        key: index,
        d,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.3',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      })
    )
  )
}

/** Small UI glyphs that are not part of the group icon set. */
export const UI_GLYPHS = Object.freeze({
  chevronDown: 'M4 6.2l4 4 4-4',
  chevronRight: 'M6.2 4l4 4-4 4',
  plus: 'M8 3.2v9.6M3.2 8h9.6',
  more: 'M3.4 8h.01M8 8h.01M12.6 8h.01',
  folderAdjust: 'M2.5 5.1h4l1.5 1.7h5.5v6.1h-11z',
  close: 'M4 4l8 8M12 4l-8 8',
  search: 'M7 2.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8zM10.4 10.4l3 3',
  sliders: 'M2.6 4.6h2.5M7.1 4.6h6.3M2.6 11.4h6.3M10.9 11.4h2.5M2.6 8h10.8M6 3.2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM10 10a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z',
  check: 'M3.2 8.4l3.1 3.1 6.5-7.1',
  grid: 'M2.6 2.6h4.4v4.4H2.6zM9 2.6h4.4v4.4H9zM2.6 9h4.4v4.4H2.6zM9 9h4.4v4.4H9z',
})

/** Render a small stroke UI glyph. Default 16px to match official sidebar icons. */
export const renderGlyph = (h, name, size = 16) =>
  h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      'aria-hidden': 'true',
      focusable: 'false',
      class: 'dsg-glyph',
    },
    h('path', {
      d: UI_GLYPHS[name] ?? UI_GLYPHS.close,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.4',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    })
  )
