/**
 * Minimal test-only React surface.
 *
 * The plugin consumes host React as a peer; Node tests have no React install.
 * This stub exists only under tests/support and is mapped by react-loader.mjs
 * so UI modules can be imported and pure components can be called without a
 * browser or a production dependency. It is intentionally not a renderer.
 */

export const Fragment = Symbol.for('react.fragment')

export class Component {
  constructor(props) {
    this.props = props ?? {}
    this.state = {}
  }

  setState(update) {
    this.state = { ...this.state, ...(typeof update === 'function' ? update(this.state, this.props) : update) }
  }

  render() {
    return null
  }
}

export class PureComponent extends Component {}

export const createElement = (type, props, ...children) => ({
  type,
  props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children },
})

export const cloneElement = (element, props) => ({
  ...element,
  props: { ...(element?.props ?? {}), ...(props ?? {}) },
})

export const isValidElement = (value) => Boolean(value && typeof value === 'object' && 'type' in value)

const initialValue = (value) => (typeof value === 'function' ? value() : value)

export const useState = (value) => [initialValue(value), () => {}]
export const useReducer = (_reducer, value) => [initialValue(value), () => {}]
export const useMemo = (factory) => factory()
export const useCallback = (callback) => callback
export const useRef = (value) => ({ current: value })
export const useEffect = () => {}
export const useLayoutEffect = () => {}
export const useInsertionEffect = () => {}
export const useImperativeHandle = () => {}
export const useContext = (context) => context?.defaultValue ?? null
export const useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot()
export const useId = () => ':react-test:'
export const useDebugValue = () => {}
export const useTransition = () => [false, (callback) => callback()]
export const useDeferredValue = (value) => value

export const createContext = (defaultValue) => ({ defaultValue, Provider: Fragment, Consumer: Fragment })
export const forwardRef = (render) => render
export const memo = (component) => component
export const createRef = () => ({ current: null })

export const Children = {
  map: (children, callback) => (Array.isArray(children) ? children : [children]).map(callback),
  toArray: (children) => (Array.isArray(children) ? children : children == null ? [] : [children]),
  only: (children) => (Array.isArray(children) ? children[0] : children),
  count: (children) => (Array.isArray(children) ? children.length : children == null ? 0 : 1),
}

export const jsx = createElement
export const jsxs = createElement

export default {
  Fragment,
  createElement,
  cloneElement,
  isValidElement,
  useState,
  useReducer,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
  useInsertionEffect,
  useImperativeHandle,
  useContext,
  useSyncExternalStore,
  useId,
  useDebugValue,
  useTransition,
  useDeferredValue,
  createContext,
  forwardRef,
  memo,
  createRef,
  Children,
}
