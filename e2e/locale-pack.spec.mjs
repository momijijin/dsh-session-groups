#!/usr/bin/env node
/**
 * A+ fixture for a third-party Japanese language pack.
 *
 * The isolated profile installs e2e/fixtures/ja-locale-pack, which calls the
 * host locale service addLanguage({id:'ja'}) and setLocale('ja'). This test
 * proves dsh-session-grove follows a language the plugin did not add to the
 * host catalog itself.
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
if (!existsSync(testHome)) fail(`test home does not exist: ${testHome}`)

const browser = await chromium.launch({
  headless: true,
  executablePath: (() => {
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    const root = resolve(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
    if (!existsSync(root)) return undefined
    const candidates = readdirSync(root).filter((name) => name.startsWith('chromium-')).sort().reverse()
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

const dismissOverlays = async () => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const stillBlocked = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
      for (const dialog of dialogs) {
        const close = dialog.querySelector('button[aria-label="Close"], button[aria-label="閉じる"], button[aria-label="关闭"]')
        if (close) {
          close.click()
          continue
        }
        const continueButton = Array.from(dialog.querySelectorAll('button')).find((button) =>
          /^(Continue|继续|続行|OK|Got it)$/i.test((button.textContent ?? '').trim()),
        )
        if (continueButton) continueButton.click()
      }
      const mask = document.querySelector('[class*="_mask_"]')
      if (dialogs.length === 0 && mask === null) return false
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return true
    })
    if (!stillBlocked) return
    await page.waitForTimeout(400)
  }
}

try {
  await page.goto(urlText, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  await dismissOverlays()

  const lang = await page.evaluate(() => document.documentElement.lang)
  if (lang !== 'ja') fail(`third-party ja pack did not activate Japanese: ${lang}`)

  const groupView = page.locator('[data-testid="session-groups-view"]')
  if ((await groupView.count()) === 0) {
    const toggle = page.locator('[data-testid="session-groups-workspace-toggle"], [data-testid="session-groups-toggle"]').first()
    if (await toggle.count()) await toggle.click()
  }
  await groupView.waitFor({ state: 'visible' })

  const onboarding = page.locator('[data-testid="session-groups-onboarding"]')
  await onboarding.waitFor({ state: 'visible' })
  const title = (await page.locator('.dsg-onboarding-title').innerText()).trim()
  if (title !== 'フリーグループへようこそ') fail(`onboarding did not use the ja dictionary: ${title}`)
  const dismiss = (await page.locator('[data-testid="session-groups-onboarding-dismiss"]').innerText()).trim()
  if (dismiss !== 'わかりました') fail(`onboarding action did not use the ja dictionary: ${dismiss}`)
  await page.locator('[data-testid="session-groups-onboarding-dismiss"]').click()
  await onboarding.waitFor({ state: 'detached' })

  await page.locator('[data-testid="session-groups-new-group"]').click()
  const dialog = page.locator('[data-testid="session-groups-dialog"]')
  await dialog.waitFor({ state: 'visible' })
  const labelledBy = await dialog.getAttribute('aria-labelledby')
  const dialogTitle = labelledBy ? (await page.locator(`#${labelledBy}`).innerText()).trim() : ''
  if (dialogTitle !== 'グループを作成') fail(`new-group dialog did not use the ja dictionary: ${dialogTitle}`)
  await page.locator('[data-testid="session-groups-dialog-cancel"]').click()

  if (pageErrors.length > 0) fail(`page errors: ${pageErrors.join('; ')}`)
  console.log('PASS: third-party ja locale pack activates Japanese onboarding and dialog copy')
} catch (error) {
  await page.screenshot({ path: `${testHome}/locale-pack-failure.png`, fullPage: false }).catch(() => {})
  fail(error instanceof Error ? error.message : String(error))
} finally {
  await context.close()
  await browser.close()
}
