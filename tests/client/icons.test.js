// tests/client/icons.test.js
//
// 0.2.5 header icon fidelity: the three header buttons render the exact DSH
// Desktop 2.0.18 workspace artwork (IconSearchOutlineRegular /
// IconSlidersTwoOutlineRegular / IconProjectAddOutlineRegular), 16px, 1px
// stroke, with no custom glyph approximations left in the header.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  HEADER_ICON_ARTWORK,
  renderHeaderIcon,
} from '../../src/client/icons.js'

const h = (type, props, ...children) => ({ type, props: props ?? {}, children })

const collect = (element, out = []) => {
  out.push(element)
  for (const child of element.children ?? []) collect(child, out)
  return out
}

test('the header icon set is exactly search, view-options, project-add', () => {
  // The artwork map is the production source of truth for the header buttons.
  assert.deepEqual(Object.keys(HEADER_ICON_ARTWORK).sort(), ['project-add', 'search', 'view-options'])
})

test('search artwork is the official 1px circle + handle geometry (viewBox 0 0 16 16)', () => {
  const artwork = HEADER_ICON_ARTWORK.search
  assert.equal(artwork.viewBox, '0 0 16 16')
  assert.equal(artwork.strokeWidth, '1')
  assert.deepEqual(artwork.filled, [])
  assert.deepEqual(artwork.stroked, [
    'M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z',
    'M10.2991 10.3933L14.7783 14.8725',
  ])
})

test('sliders-two artwork is the official two rails + two knobs', () => {
  const artwork = HEADER_ICON_ARTWORK['view-options']
  assert.equal(artwork.strokeWidth, '1')
  assert.equal(artwork.strokeLinecap, 'round')
  assert.deepEqual(artwork.stroked, ['M2.3 5h5.85M12.05 5h1.65', 'M2.3 11h1.65M7.85 11h5.85'])
  assert.deepEqual(
    artwork.circles.map((circle) => [circle.cx, circle.cy, circle.r]),
    [
      ['9.95', '5', '1.45'],
      ['5.75', '11', '1.45'],
    ]
  )
})

test('project-add artwork is the official filled project contour + plus', () => {
  const artwork = HEADER_ICON_ARTWORK['project-add']
  assert.equal(artwork.strokeWidth, '1')
  assert.equal(artwork.filled.length, 1)
  assert.match(artwork.filled[0], /^M5\.54492 2\.06738/)
  assert.match(artwork.filled[0], /Z$/)
  assert.deepEqual(artwork.stroked, ['M9.75977 4.50208H14.5509', 'M12.1492 6.89758L12.1492 2.10642'])
})

test('renderHeaderIcon emits a 16px currentColor SVG with the official children', () => {
  for (const name of Object.keys(HEADER_ICON_ARTWORK)) {
    const svg = renderHeaderIcon(h, name, 16)
    assert.equal(svg.type, 'svg')
    assert.equal(svg.props.width, 16)
    assert.equal(svg.props.height, 16)
    assert.equal(svg.props.viewBox, '0 0 16 16')
    assert.equal(svg.props['data-icon'], name)
    assert.match(svg.props.class, /dsg-glyph-official/)
    const children = collect(svg).slice(1)
    const paths = children.filter((child) => child.type === 'path')
    const circles = children.filter((child) => child.type === 'circle')
    assert.equal(paths.length, HEADER_ICON_ARTWORK[name].filled.length + HEADER_ICON_ARTWORK[name].stroked.length)
    assert.equal(circles.length, HEADER_ICON_ARTWORK[name].circles.length)
    const stroked = paths.filter((path) => path.props.stroke === 'currentColor')
    for (const path of stroked) {
      assert.equal(path.props['stroke-width'], '1')
      assert.equal(path.props.fill, 'none')
    }
  }
})
