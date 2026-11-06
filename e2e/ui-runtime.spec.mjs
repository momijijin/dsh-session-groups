#!/usr/bin/env node
/**
 * Real-browser UI runtime evidence.
 *
 * Runs against the same disposable DSH web instance as the A+ spec, but measures
 * Chromium JS coverage of the client bundle while driving the main UI surfaces.
 * It is intentionally separate from `npm test` (no DSH host in CI) and does not
 * claim source-line UI coverage; it records real browser execution.
 */
import { chromium } from 'playwright'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const urlText = process.env.DSH_TEST_URL ?? ''
const testHome = process.env.DSH_TEST_HOME ?? ''
const realHome = resolve(process.env.USERPROFILE ?? '', '.dsh')
const fail = (message) => {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}
if (!urlText) fail('DSH_TEST_URL is required')
if (!testHome) fail('DSH_TEST_HOME is required')
const url = new URL(urlText)
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) fail(`test URL must be loopback: ${url.origin}`)
if (url.port === '43120') fail('refusing the real DSH web port 43120')
if (resolve(testHome).toLowerCase().startsWith(realHome.toLowerCase())) fail(`refusing real DSH home: ${testHome}`)
if (!existsSync(testHome)) fail(`test home does not exist: ${testHome}`)

const browser = await chromium.launch({
  headless: true,
  executablePath: (() => {
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    const root = resolve(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
    if (!existsSync(root)) return undefined
    for (const name of readdirSync(root).filter((entry) => entry.startsWith('chromium-')).sort().reverse()) {
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
page.on('pageerror', (error) => pageErrors.push(error.message))

const dismissOverlays = async () => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const blocked = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
      for (const dialog of dialogs) {
        const close = dialog.querySelector('button[aria-label="Close"], button[aria-label="关闭"]')
        if (close) close.click()
      }
      const button = Array.from(document.querySelectorAll('button')).find((entry) =>
        /^(Continue|继续|知道了|关闭)$/i.test((entry.textContent ?? '').trim()),
      )
      if (button) button.click()
      const mask = document.querySelector('[class*="_mask_"]')
      if (dialogs.length === 0 && !button && mask === null) return false
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return true
    })
    if (!blocked) return
    await page.waitForTimeout(250)
  }
}

const activated = (name) => `${testHome}/ui-runtime-${name}.json`
await page.coverage.startJSCoverage({ resetOnNavigation: false })
try {
  await page.goto(urlText, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  await dismissOverlays()

  const groupView = page.locator('[data-testid="session-groups-view"]')
  if ((await groupView.count()) === 0) {
    const toggle = page.locator('[data-testid="session-groups-workspace-toggle"], [data-testid="session-groups-toggle"]').first()
    await toggle.click({ force: true })
  }
  await groupView.waitFor({ state: 'visible' })
  const onboarding = page.locator('[data-testid="session-groups-onboarding"]')
  if (await onboarding.count()) {
    await page.locator('[data-testid="session-groups-onboarding-dismiss"]').click()
    await onboarding.waitFor({ state: 'detached' })
  }

  const groupMenu = page.locator('[data-testid="session-groups-group-menu"]')
  if ((await groupMenu.count()) === 0) {
    await page.locator('[data-testid="session-groups-new-group"]').click()
    const dialog = page.locator('[data-testid="session-groups-dialog"]')
    await dialog.waitFor({ state: 'visible' })
    await page.locator('[data-testid="session-groups-dialog-input"]').fill('UI runtime')
    await page.locator('[data-testid="session-groups-dialog-confirm"]').click()
    await dialog.waitFor({ state: 'hidden' })
  }

  await page.locator('[data-testid="session-groups-view-options"]').click()
  await page.waitForTimeout(150)
  await page.keyboard.press('Escape')
  await page.locator('[data-testid="session-groups-search-toggle"]').click()
  await page.locator('[data-testid="session-groups-search"]').waitFor({ state: 'visible' })
  await page.keyboard.press('Escape')

  const groupRow = page.locator('[data-testid="session-groups-group"]').first()
  await groupRow.hover()
  await groupMenu.first().click()
  await page.locator('[data-testid="session-groups-menu"]').waitFor({ state: 'visible' })
  await page.keyboard.press('Escape')

  await page.locator('[data-testid="session-groups-new-group"]').click()
  const dialog = page.locator('[data-testid="session-groups-dialog"]')
  await dialog.waitFor({ state: 'visible' })
  await page.locator('[data-testid="session-groups-dialog-cancel"]').click()
  await dialog.waitFor({ state: 'hidden' })
} finally {
  const coverage = await page.coverage.stopJSCoverage()
  const entries = coverage.filter((entry) => entry.url.includes('dsh-session-grove/client.js'))
  let total = 0
  let used = 0
  for (const entry of entries) {
    total += entry.source.length
    const ranges = new Set()
    for (const fnEntry of entry.functions) {
      for (const range of fnEntry.ranges) {
        if (!range.count) continue
        for (let i = range.startOffset; i < range.endOffset; i += 1) ranges.add(i)
      }
    }
    used += ranges.size
  }
  const report = {
    url: url.origin,
    bundleEntries: entries.map((entry) => entry.url),
    sourceBytes: total,
    executedBytes: used,
    executedRatio: total === 0 ? 0 : used / total,
    pageErrors,
  }
  writeFileSync(activated('coverage'), JSON.stringify(report, null, 2), 'utf8')
  console.log(`UI_RUNTIME ${JSON.stringify({ bundleEntries: entries.length, executedBytes: used, sourceBytes: total, executedRatio: report.executedRatio })}`)
  await context.close().catch(() => {})
  await browser.close().catch(() => {})
  if (pageErrors.length > 0) fail(`page errors: ${pageErrors.join('; ')}`)
  if (entries.length === 0) fail('dsh-session-grove client bundle was not loaded')
  if (used === 0) fail('client bundle executed no bytes')
}
