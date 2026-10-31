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
  // 0.2.7 default new-group glyph: two slanted rails crossed by two horizontals.
  hash: ['M5.7 2.6L4.3 13.4', 'M10.2 2.6L8.8 13.4', 'M2.7 6.1h10.6', 'M2.3 10.1h10.6'],
  // 0.2.12 common group glyphs (same 16px stroke-only contract).
  briefcase: ['M2.7 5.2h10.6v8H2.7z', 'M5.6 5.2V3.9h4.8v1.3', 'M2.7 8.1h10.6'],
  book: ['M3 3.1h4.2c.7 0 1.3.6 1.3 1.3v8.4c0-.7-.6-1.3-1.3-1.3H3z', 'M13 3.1H8.8c-.7 0-1.3.6-1.3 1.3v8.4c0-.7.6-1.3 1.3-1.3H13z'],
  code: ['M5.8 5.1L2.9 8l2.9 2.9', 'M10.2 5.1L13.1 8l-2.9 2.9', 'M8.9 3.4L7.1 12.6'],
  database: ['M3.1 4.6c0-1 2.2-1.8 4.9-1.8s4.9.8 4.9 1.8-2.2 1.8-4.9 1.8S3.1 5.6 3.1 4.6z', 'M3.1 4.6v6.8c0 1 2.2 1.8 4.9 1.8s4.9-.8 4.9-1.8V4.6', 'M3.1 8c0 1 2.2 1.8 4.9 1.8s4.9-.8 4.9-1.8'],
  terminal: ['M2.6 3.3h10.8v9.4H2.6z', 'M5.1 6.2L7 8l-1.9 1.8', 'M8.5 10.1h2.6'],
  globe: ['M8 2.3a5.7 5.7 0 1 0 0 11.4A5.7 5.7 0 0 0 8 2.3z', 'M2.6 8h10.8', 'M8 2.4c-1.7 1.5-2.6 3.4-2.6 5.6s.9 4.1 2.6 5.6c1.7-1.5 2.6-3.4 2.6-5.6S9.7 3.9 8 2.4z'],
  heart: ['M8 13.3S2.7 10 2.7 6.4A2.7 2.7 0 0 1 8 4.9a2.7 2.7 0 0 1 5.3 1.5c0 3.6-5.3 6.9-5.3 6.9z'],
  home: ['M2.8 7.4L8 2.8l5.2 4.6v6.2H2.8z', 'M6.3 13.6V9.4h3.4v4.2'],
  layers: ['M8 2.5L2.8 5.4 8 8.3l5.2-2.9z', 'M2.8 8.1L8 11l5.2-2.9', 'M2.8 10.7L8 13.6l5.2-2.9'],
  calendar: ['M2.8 4.1h10.4v9.2H2.8z', 'M5.2 2.6v3', 'M10.8 2.6v3', 'M2.8 7.1h10.4'],
  chart: ['M2.7 2.8v10.5h10.6', 'M5.1 10.8V7.6', 'M8 10.8V5.3', 'M10.9 10.8V8.6'],
  target: ['M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4z', 'M8 5.1a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 0 0 0-5.8z', 'M8 7.5v1'],
  'check-circle': ['M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4z', 'M5.2 8.1l1.9 1.9 3.8-4'],
  check: ['M3.2 8.3l3 3 6.6-6.8'],
  'x-circle': ['M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4z', 'M5.8 5.8l4.4 4.4', 'M10.2 5.8l-4.4 4.4'],
  ban: ['M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4z', 'M4.3 4.3l7.4 7.4'],
  pause: ['M5.5 3.5v9', 'M10.5 3.5v9'],
  play: ['M5.2 3.4l6.8 4.6-6.8 4.6z'],
  stop: ['M4.2 4.2h7.6v7.6H4.2z'],
  clock: ['M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4z', 'M8 4.8V8l2.2 1.4'],
  hourglass: ['M4.2 2.7h7.6', 'M4.2 13.3h7.6', 'M5.1 2.7c0 3 2.9 3.4 2.9 5.3s-2.9 2.3-2.9 5.3', 'M10.9 2.7c0 3-2.9 3.4-2.9 5.3s2.9 2.3 2.9 5.3'],
  wrench: ['M9.7 2.8a3 3 0 0 0-3.9 3.9L2.8 9.7l3.5 3.5 3-3a3 3 0 0 0 3.9-3.9l-2.2 2.2-2.2-2.2z'],
  bug: ['M5.2 5.2h5.6v4.2a2.8 2.8 0 0 1-5.6 0z', 'M6.2 5.2V4.1a1.8 1.8 0 0 1 3.6 0v1.1', 'M5.2 7.2H2.8', 'M10.8 7.2h2.4', 'M5.2 10.4l-1.8 1.5', 'M10.8 10.4l1.8 1.5'],
})

/** All icon names the plugin accepts (contract set). */
export const ICON_NAMES = GROUP_ICONS

/**
 * 0.2.13 semantic sections for the icon picker. Every section is rendered with
 * a heading and a divider; names not listed here fall into the general group.
 */
export const ICON_GROUPS = Object.freeze([
  {
    key: 'status',
    labelKey: 'iconGroup.status',
    icons: ['check-circle', 'check', 'x-circle', 'ban', 'pause', 'play', 'stop', 'clock', 'hourglass'],
  },
  {
    key: 'work',
    labelKey: 'iconGroup.work',
    icons: ['code', 'terminal', 'wrench', 'bug', 'database', 'chart', 'target', 'rocket', 'briefcase', 'layers', 'book'],
  },
  {
    key: 'general',
    labelKey: 'iconGroup.general',
    icons: ['folder', 'folder-open', 'star', 'flag', 'bookmark', 'tag', 'bulb', 'globe', 'heart', 'home', 'calendar', 'hash'],
  },
])

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

// ---------------------------------------------------------------------------
// Official DSH workspace header artwork (0.2.5)
// ---------------------------------------------------------------------------
/**
 * Exact artwork copied from DSH Desktop 2.0.18
 * `@deepseek-ai/dsh-client-ui-primitives`:
 *
 * - `IconSearchOutlineRegular` (viewBox 0 0 16 16, 1px stroke, circle + handle)
 * - `IconSlidersTwoOutlineRegular` (1px stroke, two rails + two knobs)
 * - `IconProjectAddOutlineRegular` (1px stroke, project contour + plus)
 *
 * The plugin ships its own copy (no host icon dependency, CONTRACTS §0) but the
 * geometry is byte-for-byte the official one, so the three header buttons match
 * the official workspace section instead of custom approximations.
 */
export const HEADER_ICON_ARTWORK = Object.freeze({
  search: Object.freeze({
    viewBox: '0 0 16 16',
    strokeWidth: '1',
    stroke: 'currentColor',
    strokeLinecap: null,
    strokeLinejoin: null,
    filled: Object.freeze([]),
    stroked: Object.freeze([
      'M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z',
      'M10.2991 10.3933L14.7783 14.8725',
    ]),
    circles: Object.freeze([]),
  }),
  'view-options': Object.freeze({
    viewBox: '0 0 16 16',
    strokeWidth: '1',
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: null,
    filled: Object.freeze([]),
    stroked: Object.freeze(['M2.3 5h5.85M12.05 5h1.65', 'M2.3 11h1.65M7.85 11h5.85']),
    circles: Object.freeze([
      Object.freeze({ cx: '9.95', cy: '5', r: '1.45' }),
      Object.freeze({ cx: '5.75', cy: '11', r: '1.45' }),
    ]),
  }),
  'project-add': Object.freeze({
    viewBox: '0 0 16 16',
    strokeWidth: '1',
    stroke: 'currentColor',
    strokeLinecap: null,
    strokeLinejoin: null,
    filled: Object.freeze([
      'M5.54492 2.06738C5.91034 2.06754 6.26318 2.20149 6.53711 2.44336L7.94043 3.68164V4.7998C7.71462 4.74105 7.50367 4.63139 7.32617 4.47461L5.87598 3.19238C5.78477 3.11185 5.66658 3.06754 5.54492 3.06738H2.94922C2.67322 3.06738 2.44946 3.29145 2.44922 3.56738V12.4326C2.44927 12.7087 2.67311 12.9326 2.94922 12.9326H12.9326C13.2086 12.9325 13.4326 12.7086 13.4326 12.4326V8.53613H14.4326V12.4326C14.4326 13.2609 13.7609 13.9325 12.9326 13.9326H2.94922C2.12083 13.9326 1.44927 13.261 1.44922 12.4326V3.56738C1.44946 2.73916 2.12094 2.06738 2.94922 2.06738H5.54492Z',
    ]),
    stroked: Object.freeze(['M9.75977 4.50208H14.5509', 'M12.1492 6.89758L12.1492 2.10642']),
    circles: Object.freeze([]),
  }),
})

/** Header action names mapped to the official artwork above. */
export const HEADER_ICON_NAMES = Object.freeze(['search', 'view-options', 'project-add'])

/**
 * Render one official header artwork at `size` (default 16, matching the
 * official workspace header). Fill/stroke are separated exactly like the
 * primitives package so the silhouette matches the official icon.
 */
export const renderHeaderIcon = (h, name, size = 16) => {
  const artwork = HEADER_ICON_ARTWORK[name] ?? HEADER_ICON_ARTWORK.search
  const children = []
  for (const d of artwork.filled) {
    children.push(h('path', { key: `f${children.length}`, d, fill: 'currentColor', stroke: 'none' }))
  }
  for (const d of artwork.stroked) {
    children.push(
      h('path', {
        key: `s${children.length}`,
        d,
        fill: 'none',
        stroke: artwork.stroke,
        'stroke-width': artwork.strokeWidth,
        ...(artwork.strokeLinecap ? { 'stroke-linecap': artwork.strokeLinecap } : {}),
        ...(artwork.strokeLinejoin ? { 'stroke-linejoin': artwork.strokeLinejoin } : {}),
      })
    )
  }
  for (const circle of artwork.circles) {
    children.push(
      h('circle', {
        key: `c${children.length}`,
        cx: circle.cx,
        cy: circle.cy,
        r: circle.r,
        fill: 'none',
        stroke: artwork.stroke,
        'stroke-width': artwork.strokeWidth,
        ...(artwork.strokeLinecap ? { 'stroke-linecap': artwork.strokeLinecap } : {}),
      })
    )
  }
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: artwork.viewBox,
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': 'true',
      focusable: 'false',
      class: 'dsg-glyph dsg-glyph-official',
      'data-icon': name,
    },
    ...children
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
