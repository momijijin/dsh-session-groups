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
import { existsSync, readdirSync } from 'node:fs'

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
page.on('pageerror', (error) => console.error(`PAGE_ERROR: ${error.message}`))
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
  await menuItem(/新建子分组/).click()
  await page.locator('[data-testid="session-groups-dialog-input"]').fill(name)
  await page.locator('[data-testid="session-groups-dialog-confirm"]').click()
  await groupRow(name).waitFor({ state: 'visible' })
}

const moveGroup = async (sourceId, targetId) => {
  const source = groupRowById(sourceId)
  await source.locator('[data-testid="session-groups-group-menu"]').click({ force: true })
  await menuItem(/移动到分组/).click()
  await page.locator(`[data-testid="session-groups-dialog-group"][data-group-id="${targetId}"]`).click()
  await page.locator('[data-testid="session-groups-dialog-confirm"]').click()
  await page.waitForTimeout(500)
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

  console.log('PASS: isolated onboarding, three status buttons, move-group head insertion')
} catch (error) {
  await screenshot()
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await context.close().catch(() => {})
  await browser.close().catch(() => {})
}
