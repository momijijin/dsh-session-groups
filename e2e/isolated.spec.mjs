#!/usr/bin/env node
/**
 * A+ isolated Playwright smoke.
 *
 * Drives a disposable DSH web instance started by
 * scripts/qa/start-isolated-web.ps1. It never attaches to the real DSH window:
 * DSH_TEST_URL must be the isolated port, and DSH_TEST_HOME must not live under
 * the real ~/.dsh.
 */
import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const urlText = process.env.DSH_TEST_URL ?? ''
const testHome = process.env.DSH_TEST_HOME ?? ''
const realHome = resolve(process.env.USERPROFILE ?? '', '.dsh')

const fail = (message) => {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}
if (!urlText) fail('DSH_TEST_URL is required')
if (!testHome) fail('DSH_TEST_HOME is required')
if (resolve(testHome).toLowerCase().startsWith(realHome.toLowerCase())) fail(`refusing real DSH home: ${testHome}`)

let url
try {
  url = new URL(urlText)
} catch {
  fail(`invalid DSH_TEST_URL: ${urlText}`)
}
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) fail(`test URL must be loopback: ${url.origin}`)
if (url.port === '43120') fail('refusing the real DSH web port 43120')
if (!existsSync(testHome)) fail(`test home does not exist: ${testHome}`)

const browser = await chromium.launch({
  headless: true,
  // The local Playwright package can be newer than the installed browser
  // build; use the on-disk Chromium when it exists instead of silently
  // downloading a browser during a test run.
  executablePath: (() => {
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    const root = resolve(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
    if (!existsSync(root)) return undefined
    const candidates = readdirSync(root)
      .filter((name) => name.startsWith('chromium-'))
      .sort()
      .reverse()
    for (const name of candidates) {
      const path = resolve(root, name, 'chrome-win64', 'chrome.exe')
      if (existsSync(path)) return path
    }
    return undefined
  })(),
})
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
page.setDefaultTimeout(12_000)
const pageErrors = []
page.on('pageerror', (error) => {
  pageErrors.push(error.message)
  console.error(`PAGE_ERROR: ${error.message}`)
})
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error(`PAGE_CONSOLE: ${msg.text()}`)
})

const groupView = page.locator('[data-testid="session-groups-view"]')
const screenshot = () => page.screenshot({ path: `${testHome}/isolated-failure.png`, fullPage: false }).catch(() => {})

const dismissShippedOverlays = async () => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const clicked = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
      for (const dialog of dialogs) {
        const label = dialog.getAttribute('aria-label') ?? ''
        const text = (dialog.textContent ?? '').trim()
        if (!/get started|开始使用/i.test(label) && !/Add API Key|Sign in to your DeepSeek|添加 API Key/i.test(text)) continue
        const close = dialog.querySelector('button[aria-label="Close"], button[aria-label="关闭"], button[title="Close"], button[title="关闭"]')
        if (close) {
          close.click()
          return 'onboarding-close'
        }
      }
      const textButton = Array.from(document.querySelectorAll('button')).find((el) => /^(Continue|继续|知道了|关闭)$/i.test((el.textContent ?? '').trim()))
      if (textButton) {
        textButton.click()
        return 'text'
      }
      const closeButton = Array.from(document.querySelectorAll('button,[role="button"]')).find((el) => {
        const text = (el.textContent ?? '').trim()
        const label = el.getAttribute('aria-label') ?? ''
        return /^(Close|关闭|×|✕)$/i.test(text) || /^(close|关闭)$/i.test(label)
      })
      if (closeButton) {
        closeButton.click()
        return 'close'
      }
      if (document.querySelector('[role="dialog"]')) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        return 'escape'
      }
      return false
    })
    if (!clicked) return
    await page.waitForTimeout(350)
  }
}

const closeGetStarted = async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const dialog = page.locator('[role="dialog"][aria-label="Get started"]')
    if ((await dialog.count()) > 0) {
      const close = dialog.locator('button[aria-label="Close"]')
      if ((await close.count()) > 0) await close.first().click()
      else await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      if ((await dialog.count()) === 0) return true
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      if ((await dialog.count()) === 0) return true
    }
    await page.waitForTimeout(300)
  }
  return false
}

const groupRows = () => page.locator('[data-testid="session-groups-group"]')
const groupRow = (name) => groupRows().filter({ hasText: name }).first()
const groupRowById = (id) => page.locator(`[data-testid="session-groups-group"][data-group-id="${id}"]`)
const menuItem = (pattern) => page.locator('[role="menuitem"]').filter({ hasText: pattern }).first()

const createGroup = async (name) => {
  await page.locator('[data-testid="session-groups-new-group"]').click()
  await page.locator('[data-testid="session-groups-dialog-input"]').fill(name)
  await page.locator('[data-testid="session-groups-dialog-confirm"]').click()
  const row = groupRow(name)
  await row.waitFor({ state: 'visible' })
  return await row.getAttribute('data-group-id')
}

const createChildGroup = async (parentId, name) => {
  const parent = groupRowById(parentId)
  await parent.locator('[data-testid="session-groups-group-menu"]').click({ force: true })
  await menuItem(/新建子分组|New subgroup/).click()
  await page.locator('[data-testid="session-groups-dialog-input"]').fill(name)
  await page.locator('[data-testid="session-groups-dialog-confirm"]').click()
  await groupRow(name).waitFor({ state: 'visible' })
}

const moveGroup = async (sourceId, targetId) => {
  const source = groupRowById(sourceId)
  await source.locator('[data-testid="session-groups-group-menu"]').click({ force: true })
  await menuItem(/移动到分组|Move to group/).click()
  await page.locator(`[data-testid="session-groups-dialog-group"][data-group-id="${targetId}"]`).click()
  await page.locator('[data-testid="session-groups-dialog-confirm"]').click()
  await page.waitForTimeout(500)
}

const moveSessionToGroup = async (sessionId, targetId) => {
  const session = page.locator(`[data-testid="session-groups-session"][data-session-id="${sessionId}"]`).first()
  await session.locator('[data-testid="session-groups-session-menu"]').click({ force: true })
  await menuItem(/移动到分组|Move to group/).click()
  await page.locator(`[data-testid="session-groups-dialog-group"][data-group-id="${targetId}"]`).click()
  await page.locator('[data-testid="session-groups-dialog-confirm"]').click()
  await page.waitForTimeout(500)
}

const addSessionToGroup = async (groupId) => {
  const addButton = groupRowById(groupId).locator('[data-testid="session-groups-group-add"]')
  await addButton.click({ force: true })
  await page.locator('[data-testid="session-groups-dialog"]').waitFor({ state: 'visible' })
  const workspaceOption = page.locator('[data-testid="session-groups-dialog-workspace"]').first()
  if ((await workspaceOption.count()) > 0) await workspaceOption.click({ force: true })
  const confirm = page.locator('[data-testid="session-groups-dialog-confirm"]')
  if (!(await confirm.isEnabled())) throw new Error('new-session dialog has no enabled workspace/confirm')
  await confirm.click()
  await page.waitForTimeout(1500)
}

const readTestDoc = () => JSON.parse(readFileSync(resolve(testHome, 'storages', 'dsh-session-groups.json'), 'utf8'))

const groupSessionIds = (groupId) => {
  const doc = readTestDoc()
  return doc.groups.find((group) => group.id === groupId)?.sessionIds ?? []
}

try {
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  // First boot on a fresh home shows the shipped preview notice and account
  // modal. Dismiss only their close/continue affordances; never sign in or add
  // credentials.
  await page.waitForTimeout(1500)
  await dismissShippedOverlays()
  await closeGetStarted()
  await page.waitForTimeout(800)

  // If the app opens on the shipped workspace view, use the plugin's overlay
  // toggle; once the groups view is active the header toggle owns switching back.
  if ((await groupView.count()) === 0) {
    const toggle = page.locator('[data-testid="session-groups-workspace-toggle"], [data-testid="session-groups-toggle"]').first()
    if ((await toggle.count()) === 0) {
      console.error(`plugin test ids: ${JSON.stringify(await page.locator('[data-testid^="session-groups"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid'))))}`)
      await screenshot()
      throw new Error('session groups view/toggle missing; check isolated profile boot')
    }
    await toggle.click()
  }
  await groupView.waitFor({ state: 'visible' })

  const onboarding = page.locator('[data-testid="session-groups-onboarding"]')
  await onboarding.waitFor({ state: 'visible' })
  await page.locator('[data-testid="session-groups-onboarding-dismiss"]').click()
  await onboarding.waitFor({ state: 'detached' })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  if ((await groupView.count()) === 0) {
    const toggle = page.locator('[data-testid="session-groups-workspace-toggle"], [data-testid="session-groups-toggle"]').first()
    if (await toggle.count()) await toggle.click()
  }
  await groupView.waitFor({ state: 'visible' })
  if ((await page.locator('[data-testid="session-groups-onboarding"]').count()) !== 0) {
    throw new Error('onboarding reappeared after dismissal')
  }

  for (const id of ['session-groups-running-button', 'session-groups-blocked-button', 'session-groups-unread-button']) {
    const button = page.locator(`[data-testid="${id}"]`)
    if ((await button.count()) !== 1) throw new Error(`expected one ${id}`)
  }
  if ((await page.locator('[data-testid="session-groups-background-button"]').count()) !== 0) {
    throw new Error('background-jobs button must not exist')
  }

  // Move-to-group must land at the target parent head, above existing children.
  await closeGetStarted()
  const suffix = Date.now().toString(36).slice(-6)
  const targetName = `Target ${suffix}`
  const childName = `Child ${suffix}`
  const sourceName = `Source ${suffix}`
  const targetId = await createGroup(targetName)
  await createChildGroup(targetId, childName)
  const sourceId = await createGroup(sourceName)
  await moveGroup(sourceId, targetId)
  const ordered = await groupRows().evaluateAll((rows) => rows.map((row) => row.getAttribute('data-group-id')))
  const targetAt = ordered.indexOf(targetId)
  const sourceAt = ordered.indexOf(sourceId)
  if (targetAt < 0 || sourceAt !== targetAt + 1) {
    throw new Error(`moved group must be the first child of target, order=${JSON.stringify(ordered.slice(targetAt, targetAt + 3))}`)
  }

  // Seed one session in the target and one in the source, then move the
  // source's session through the dialog. Blank sessions are hidden from the
  // tree, so verify the persisted order for the second one.
  await addSessionToGroup(targetId)
  const seededTargetIds = groupSessionIds(targetId)
  if (seededTargetIds.length === 0) throw new Error('new session did not land in target group')
  await addSessionToGroup(sourceId)
  const sourceSessionIds = groupSessionIds(sourceId)
  if (sourceSessionIds.length === 0) throw new Error('new session did not land in source group')
  const moved = sourceSessionIds[0]
  await moveSessionToGroup(moved, targetId)
  const targetSessionIds = groupSessionIds(targetId)
  if (targetSessionIds[0] !== moved || targetSessionIds[1] !== seededTargetIds[0]) {
    throw new Error(`moved session must land at target head, got ${JSON.stringify(targetSessionIds)}`)
  }

  // Collapse and re-expand the target: the persisted head order must survive.
  const targetRow = groupRowById(targetId)
  await targetRow.click({ force: true })
  await page.waitForTimeout(300)
  if ((await targetRow.getAttribute('aria-expanded')) !== 'false') throw new Error('target group did not collapse')
  await targetRow.click({ force: true })
  await page.waitForTimeout(300)
  if ((await targetRow.getAttribute('aria-expanded')) !== 'true') throw new Error('target group did not expand')
  const afterToggle = groupSessionIds(targetId)
  if (afterToggle[0] !== moved || afterToggle[1] !== seededTargetIds[0]) {
    throw new Error(`moved session order changed after collapse/expand: ${JSON.stringify(afterToggle)}`)
  }

  // Header search must find a group by its name and close cleanly.
  await page.evaluate(() => document.querySelector('[data-testid="session-groups-search-toggle"]')?.click())
  const search = page.locator('[data-testid="session-groups-search"]')
  await search.waitFor({ state: 'visible' })
  await search.fill(targetName)
  await page.waitForTimeout(500)
  const searchText = (await page.locator('[data-testid="session-groups-search-result"]').allTextContents()).join('\n')
  if (!searchText.includes(targetName)) throw new Error(`search did not find ${targetName}: ${JSON.stringify(searchText)}`)
  await page.evaluate(() => document.querySelector('[data-testid="session-groups-search-close"]')?.click())
  await page.waitForTimeout(300)

  // Narrow sidebar visual gate: the sidebar must not create horizontal overflow.
  await page.evaluate(() => localStorage.setItem('dsh-session-groups.width.v1', '264'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await closeGetStarted()
  if ((await groupView.count()) === 0) {
    const toggle = page.locator('[data-testid="session-groups-workspace-toggle"], [data-testid="session-groups-toggle"]').first()
    if (await toggle.count()) await toggle.click()
  }
  await groupView.waitFor({ state: 'visible' })
  const narrow = await page.evaluate(() => {
    const root = document.querySelector('.dsg-root')
    const rect = root?.getBoundingClientRect()
    return {
      rootWidth: rect?.width ?? null,
      rootClientWidth: root?.clientWidth ?? null,
      rootScrollWidth: root?.scrollWidth ?? null,
      headerButtons: document.querySelectorAll('.dsg-status-actions .dsg-status-action').length,
    }
  })
  if (narrow.headerButtons !== 3) throw new Error(`narrow layout expected three status buttons, got ${narrow.headerButtons}`)
  if (narrow.rootScrollWidth > narrow.rootClientWidth + 1) {
    throw new Error(`narrow layout overflows horizontally: ${JSON.stringify(narrow)}`)
  }
  await page.screenshot({ path: `${testHome}/narrow-264.png` })

  const lightContrast = await page.evaluate(() => {
    const parse = (value) => {
      const match = value?.match(/rgba?\(([^)]+)\)/)
      if (!match) return null
      const [r, g, b, a = 1] = match[1].split(',').map(Number)
      return { r, g, b, a }
    }
    const background = (el) => {
      let node = el
      while (node) {
        const value = getComputedStyle(node).backgroundColor
        if (value && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') return parse(value)
        node = node.parentElement
      }
      return parse(getComputedStyle(document.body).backgroundColor)
    }
    const luminance = ({ r, g, b }) => {
      const channel = (v) => {
        const n = v / 255
        return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }
    const contrast = (el) => {
      const fg = parse(getComputedStyle(el).color)
      const bg = background(el)
      if (!fg || !bg) return null
      const a = luminance(fg), b = luminance(bg)
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    }
    return {
      header: contrast(document.querySelector('.dsg-header-label')),
      status: contrast(document.querySelector('.dsg-status-action')),
    }
  })
  if (!(lightContrast.header >= 4.5)) throw new Error(`header contrast too low: ${JSON.stringify(lightContrast)}`)
  if (!(lightContrast.status >= 3)) throw new Error(`status contrast too low: ${JSON.stringify(lightContrast)}`)

  // Runtime locale/theme gates. The test host boots in English; dark mode is
  // applied through the shipped data-ds-dark-theme attribute and must change
  // theme tokens without introducing overflow.
  const lang = await page.evaluate(() => document.documentElement.lang)
  if (!/^en/i.test(lang)) throw new Error(`isolated host expected English locale, got ${lang}`)
  const headerLabel = (await page.locator('.dsg-header-label').first().textContent()) ?? ''
  if (headerLabel !== 'Free groups') throw new Error(`plugin did not follow the English host locale: ${headerLabel}`)
  const lightToken = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim())
  await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
  await page.waitForTimeout(300)
  const dark = await page.evaluate(() => {
    const token = getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim()
    const root = document.querySelector('.dsg-root')
    return { token, rootScrollWidth: root?.scrollWidth ?? null, rootClientWidth: root?.clientWidth ?? null }
  })
  if (!lightToken || lightToken === dark.token) throw new Error(`dark theme did not change tokens: ${lightToken} -> ${dark.token}`)
  if (dark.rootScrollWidth > dark.rootClientWidth + 1) throw new Error('dark narrow layout overflows')
  await page.screenshot({ path: `${testHome}/dark-264.png` })

  // Host sidebar collapse must switch to the rail without a React hook-order
  // crash, then restore the groups view on expand.
  const collapse = page.locator('button[aria-label="Collapse sidebar"]').first()
  if ((await collapse.count()) !== 1) throw new Error('host sidebar collapse button missing')
  await page.evaluate(() => document.querySelector('button[aria-label="Collapse sidebar"]')?.click())
  await page.waitForTimeout(800)
  const collapsedBody = await page.locator('body').innerText()
  if (/分组视图出错|The groups view failed|render error/i.test(collapsedBody)) {
    throw new Error('sidebar collapse triggered the groups render error')
  }
  if (pageErrors.some((message) => /React error #300|targetSessionId|hook/i.test(message))) {
    throw new Error(`sidebar collapse emitted a React error: ${pageErrors.join(' | ')}`)
  }
  const expand = page.locator('[data-testid="session-groups-rail-expand"]').first()
  if ((await expand.count()) > 0) await page.evaluate(() => document.querySelector('[data-testid="session-groups-rail-expand"]')?.click())
  await page.waitForTimeout(800)
  await groupView.waitFor({ state: 'visible' })

  console.log('PASS: isolated onboarding, search, status buttons, head insertion, collapse/expand, 264px, dark, host rail')
} catch (error) {
  await screenshot()
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await context.close().catch(() => {})
  await browser.close().catch(() => {})
}

