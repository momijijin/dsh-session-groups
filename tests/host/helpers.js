/**
 * Test harness for the V1 host half: fake Cordis context, fake node:http
 * request/response pairs, and a temporary-directory store factory.
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { registerRoutes } from '../../src/host/routes.js'
import { createStore } from '../../src/host/store.js'

/** A valid frozen-contract document: one nested group and one ungrouped id. */
export const sampleDoc = () => ({
  version: 1,
  groups: [
    {
      id: 'g-aaaaaaaaaaaa',
      name: '施工中',
      icon: 'folder-open',
      parentId: null,
      sessionIds: ['s-1', 's-2'],
    },
    {
      id: 'g-bbbbbbbbbbbb',
      name: '子组',
      icon: 'folder',
      parentId: 'g-aaaaaaaaaaaa',
      sessionIds: ['s-3'],
    },
  ],
  ungrouped: ['s-4'],
})

/** Create a temporary store whose record file sits in a fresh storages dir. */
export const makeTempStore = async (now) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsg-host-v1-'))
  const storages = join(dir, 'storages')
  await mkdir(storages, { recursive: true })
  const filePath = join(storages, 'dsh-session-groups.json')
  const store = createStore(now === undefined ? { filePath } : { filePath, now })
  return {
    dir,
    storages,
    filePath,
    store,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

/** Fake node:http request. Body may be a string, Buffer, or undefined. */
export const makeRequest = ({ method = 'GET', url = '/', headers = {}, body } = {}) => {
  const chunks = body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(body)]
  const req = Readable.from(chunks)
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:4400', ...headers }
  req.socket = { remoteAddress: '127.0.0.1' }
  req.connection = req.socket
  return req
}

/** Fake node:http response capturing status, headers, and body. */
export const makeResponse = () => {
  const res = {
    statusCode: 0,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) {
      res.headers[String(name).toLowerCase()] = value
    },
    end(chunk) {
      res.ended = true
      res.body = chunk === undefined ? '' : String(chunk)
    },
    resume() {
      // node:http drain hook; nothing to do in the fake.
    },
  }
  return res
}

/**
 * Build a fake Cordis context. `connection` is optional; omitting it exercises
 * the fail-closed 503 path. `logger` records info/warn calls for assertions.
 */
export const makeContext = (options = {}) => {
  const services = new Map()
  if (options.connection !== undefined) services.set('connection', options.connection)
  const routes = []
  const disposers = []
  const logs = { info: [], warn: [] }
  const defaultServer = {
    port: 4400,
    register(route) {
      routes.push(route)
      return () => {
        const index = routes.indexOf(route)
        if (index !== -1) routes.splice(index, 1)
      }
    },
  }
  // `webServer: null` explicitly means "composition without a webServer".
  const webServer = Object.hasOwn(options, 'webServer') ? options.webServer : defaultServer
  const ctx = {
    logger: {
      info: (message) => logs.info.push(String(message)),
      warn: (message) => logs.warn.push(String(message)),
    },
    get(serviceName) {
      return services.get(serviceName)
    },
    effect(body) {
      const disposer = body()
      disposers.push(disposer)
      return () => {
        disposer?.()
      }
    },
    webServer,
  }
  return {
    ctx,
    routes,
    logs,
    disposeAll() {
      for (const disposer of disposers.splice(0)) disposer?.()
    },
  }
}

/** Mount both routes over a temporary store (or a provided one). */
export const mountRoutes = async (options = {}) => {
  let temp
  if (options.store !== undefined) {
    temp = {
      dir: options.dir,
      filePath: options.filePath,
      store: options.store,
      cleanup: () => Promise.resolve(),
    }
  } else {
    temp = await makeTempStore()
  }
  const context = makeContext(options)
  const mounted = registerRoutes(context.ctx, temp.store)
  return {
    ...temp,
    ...context,
    mounted,
    async call(path, request) {
      const route = context.routes.find((candidate) => candidate.path === path)
      if (route === undefined) throw new Error(`route not registered: ${path}`)
      const res = makeResponse()
      await route.handler(request, res)
      let json
      try {
        json = JSON.parse(res.body)
      } catch {
        json = undefined
      }
      return { res, json }
    },
  }
}
