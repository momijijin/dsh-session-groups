#!/usr/bin/env node
/**
 * Locale switch smoke for every packaged dictionary.
 *
 * The test-only locale pack adds all packaged languages to the host catalog
 * (the plugin itself does not call addLanguage). This spec switches the host
 * locale through that pack and verifies the plugin header + new-group dialog
 * for each language, including zh-TW and pt-BR aliases.
 */
import { chromium } from 'playwright'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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
if (resolve(testHome).toLowerCase().startsWith(realHome.toLowerCase())) fail(`refusing real DSH home: ${testHome}`)

const dictionaries = Object.fromEntries(
  ['en', 'zh', 'zh-Hant', 'ja', 'ko', 'de', 'fr', 'es', 'pt', 'it', 'nl', 'pl', 'tr', 'vi', 'th', 'id', 'ru', 'hi', 'ar'].map(
    (id) => [id, JSON.parse(readFileSync(new URL(`../locale/${id}.json`, import.meta.url), 'utf8'))],
  ),
)
const cases = [
  ['en', 'en'],
  ['zh', 'zh'],
  ['zh-Hant', 'zh-Hant'],
  ['zh-TW', 'zh-Hant'],
  ['zh-HK', 'zh-Hant'],
  ['zh-CN', 'zh'],
  ['ja', 'ja'],
  ['ko', 'ko'],
  ['de', 'de'],
  ['fr', 'fr'],
  ['es', 'es'],
  ['pt', 'pt'],
  ['pt-BR', 'pt'],
  ['it', 'it'],
  ['nl', 'nl'],
  ['pl', 'pl'],
  ['tr', 'tr'],
  ['vi', 'vi'],
  ['th', 'th'],
  ['id', 'id'],
  ['ru', 'ru'],
  ['hi', 'hi'],
  ['ar', 'ar'],
]

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

const dismissOverlays = async () => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const blocked = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
      for (const dialog of dialogs) {
        const button = Array.from(dialog.querySelectorAll('button')).find((candidate) =>
          /^(Continue|继续|続行|OK|Got it)$/i.test((candidate.textContent ?? '').trim()),
        )
        if (button) button.click()
        else dialog.querySelector('button[aria-label="Close"]')?.click()
      }
      const mask = document.querySelector('[class*="_mask_"]')
      if (dialogs.length === 0 && mask === null) return false
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return true
    })
    if (!blocked) return
    await page.waitForTimeout(350)
  }
}

try {
  await page.goto(urlText, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  await dismissOverlays()
  await page.waitForFunction(() => typeof globalThis.__DSH_E2E_SET_LOCALE__ === 'function')

  const groupView = page.locator('[data-testid="session-groups-view"]')
  if ((await groupView.count()) === 0) {
    const toggle = page.locator('[data-testid="session-groups-workspace-toggle"], [data-testid="session-groups-toggle"]').first()
    if (await toggle.count()) await toggle.click()
  }
  await groupView.waitFor({ state: 'visible' })
  const onboarding = page.locator('[data-testid="session-groups-onboarding"]')
  if (await onboarding.count()) {
    await page.locator('[data-testid="session-groups-onboarding-dismiss"]').click()
    await onboarding.waitFor({ state: 'detached' })
  }

  for (const [localeId, dictionaryId] of cases) {
    await page.evaluate((id) => globalThis.__DSH_E2E_SET_LOCALE__(id), localeId)
    await page.waitForFunction((id) => globalThis.__DSH_E2E_GET_LOCALE__?.().active === id, localeId)
    const expectedTitle = dictionaries[dictionaryId]['view.title']
    await page.waitForFunction((expected) => {
      const label = document.querySelector('.dsg-header-label')
      return label?.textContent?.trim() === expected
    }, expectedTitle)
    const expectedDirection = localeId === 'ar' ? 'rtl' : 'ltr'
    const actualDirection = await page.locator('[data-testid="session-groups-view"]').getAttribute('dir')
    if (actualDirection !== expectedDirection) {
      throw new Error(`${localeId}: direction ${actualDirection} != ${expectedDirection}`)
    }

    await page.locator('[data-testid="session-groups-new-group"]').click()
    const dialog = page.locator('[data-testid="session-groups-dialog"]')
    await dialog.waitFor({ state: 'visible' })
    const labelledBy = await dialog.getAttribute('aria-labelledby')
    const expectedDialogTitle = dictionaries[dictionaryId]['dialog.newGroup']
    await page.waitForFunction(
      (expected) => document.querySelector('#dsg-dialog-title')?.textContent?.trim() === expected,
      expectedDialogTitle,
      { timeout: 5000 },
    )
    const actualDialogTitle = labelledBy ? (await page.locator(`#${labelledBy}`).innerText()).trim() : ''
    if (actualDialogTitle !== expectedDialogTitle) {
      throw new Error(`${localeId}: dialog title ${JSON.stringify(actualDialogTitle)} != ${JSON.stringify(expectedDialogTitle)}`)
    }
    await page.locator('[data-testid="session-groups-dialog-cancel"]').click()
    await dialog.waitFor({ state: 'hidden' })
    console.log(`PASS ${localeId} -> ${dictionaryId}: ${expectedTitle}`)
  }

  if (pageErrors.length > 0) fail(`page errors: ${pageErrors.join('; ')}`)
  console.log(`PASS: all ${cases.length} locale switch cases`)
} catch (error) {
  await page.screenshot({ path: `${testHome}/all-locales-failure.png`, fullPage: false }).catch(() => {})
  fail(error instanceof Error ? error.message : String(error))
} finally {
  await context.close()
  await browser.close()
}
