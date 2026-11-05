#!/usr/bin/env node
/**
 * Capture Arabic RTL screenshots from an isolated DSH web profile.
 *
 * Requires a host started with the test-only locale pack so
 * `__DSH_E2E_SET_LOCALE__` is available. Writes PNGs into
 * `qa-artifacts/rtl-<timestamp>/` without touching the real DSH home.
 */
import { chromium } from 'playwright'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const urlText = process.env.DSH_TEST_URL ?? ''
const testHome = process.env.DSH_TEST_HOME ?? ''
if (!urlText || !testHome) {
  console.error('DSH_TEST_URL and DSH_TEST_HOME are required')
  process.exit(1)
}
const outputDir = resolve('qa-artifacts', `rtl-${new Date().toISOString().slice(0, 10)}-${Date.now()}`)
mkdirSync(outputDir, { recursive: true })

const chromiumPath = (() => {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  const root = resolve(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
  if (!existsSync(root)) return undefined
  const candidates = readdirSync(root).filter((name) => name.startsWith('chromium-')).sort().reverse()
  for (const name of candidates) {
    const path = resolve(root, name, 'chrome-win64', 'chrome.exe')
    if (existsSync(path)) return path
  }
  return undefined
})()

const browser = await chromium.launch({ headless: true, executablePath: chromiumPath })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
page.setDefaultTimeout(15_000)
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))

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

const setLocale = async (id) => {
  await page.evaluate((localeId) => globalThis.__DSH_E2E_SET_LOCALE__(localeId), id)
  await page.waitForFunction((localeId) => globalThis.__DSH_E2E_GET_LOCALE__?.().active === localeId, id)
}

const snap = async (name) => {
  const path = resolve(outputDir, `${name}.png`)
  await page.screenshot({ path, fullPage: false })
  console.log(`SHOT ${path}`)
  return path
}

try {
  await page.goto(urlText, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  await dismissOverlays()
  await page.waitForFunction(() => typeof globalThis.__DSH_E2E_SET_LOCALE__ === 'function')
  await setLocale('ar')
  await page.waitForTimeout(700)

  const groupView = page.locator('[data-testid="session-groups-view"]')
  if ((await groupView.count()) === 0) {
    await dismissOverlays()
    const toggle = page.locator('[data-testid="session-groups-workspace-toggle"], [data-testid="session-groups-toggle"]').first()
    if (await toggle.count()) await toggle.click({ force: true })
  }
  await groupView.waitFor({ state: 'visible' })
  const onboarding = page.locator('[data-testid="session-groups-onboarding"]')
  if (await onboarding.count()) {
    await page.locator('[data-testid="session-groups-onboarding-dismiss"]').click()
    await onboarding.waitFor({ state: 'detached' })
  }

  const groupMenuButton = page.locator('[data-testid="session-groups-group-menu"]')
  if ((await groupMenuButton.count()) === 0) {
    await page.locator('[data-testid="session-groups-new-group"]').click()
    const createDialog = page.locator('[data-testid="session-groups-dialog"]')
    await createDialog.waitFor({ state: 'visible' })
    await page.locator('[data-testid="session-groups-dialog-input"]').fill('RTL Review')
    await page.locator('[data-testid="session-groups-dialog-confirm"]').click()
    await createDialog.waitFor({ state: 'hidden' })
    await groupMenuButton.first().waitFor({ state: 'visible' })
  }

  await page.waitForTimeout(500)
  const groupsMetrics = await page.evaluate(() => {
    const root = document.querySelector('.dsg-root')
    const header = root?.querySelector('.dsg-header-label')
    return {
      dir: root?.getAttribute('dir') ?? null,
      header: header?.textContent?.trim() ?? null,
      rootScroll: root?.scrollWidth ?? 0,
      rootClient: root?.clientWidth ?? 0,
    }
  })
  console.log(`GROUPS ${JSON.stringify(groupsMetrics)}`)
  await snap('01-rtl-groups-1280')

  // New-group dialog
  await page.locator('[data-testid="session-groups-new-group"]').click()
  const dialog = page.locator('[data-testid="session-groups-dialog"]')
  await dialog.waitFor({ state: 'visible' })
  await page.waitForTimeout(300)
  await snap('02-rtl-new-group-dialog')
  await page.locator('[data-testid="session-groups-dialog-cancel"]').click()
  await dialog.waitFor({ state: 'hidden' })

  // Group menu
  const firstGroupRow = page.locator('[data-testid="session-groups-group"]').first()
  await firstGroupRow.hover()
  await groupMenuButton.first().click()
  const menu = page.locator('[data-testid="session-groups-menu"]')
  await menu.waitFor({ state: 'visible' })
  await page.waitForFunction(
    () => document.querySelector('[data-testid="session-groups-menu"]')?.innerText?.includes('مجموعة'),
    undefined,
    { timeout: 5000 },
  ).catch(() => {})
  await page.waitForTimeout(300)
  const menuMetrics = await page.evaluate(() => {
    const menu = document.querySelector('[data-testid="session-groups-menu"]')
    const root = document.querySelector('.dsg-root')
    const box = menu?.getBoundingClientRect()
    const viewportWidth = globalThis.innerWidth
    return {
      text: menu?.innerText?.slice(0, 240) ?? '',
      dir: menu?.getAttribute('dir') ?? root?.getAttribute('dir') ?? null,
      inside: Boolean(box && box.left >= 0 && box.top >= 0 && box.right <= viewportWidth + 1 && box.bottom <= globalThis.innerHeight + 1),
      box: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
    }
  })
  console.log(`MENU ${JSON.stringify(menuMetrics)}`)
  await snap('03-rtl-group-menu')
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden' })

  // Narrow sidebar at the 264 px minimum; capture the overflow metrics too.
  await page.setViewportSize({ width: 1024, height: 900 })
  const railExpand = page.locator('[data-testid="session-groups-rail-expand"]')
  if (await railExpand.count()) {
    await railExpand.first().click()
    await page.locator('.dsg-root').waitFor({ state: 'visible' })
  }
  const resizeHandle = page.locator('[data-testid="session-groups-resize-handle"]')
  if (await resizeHandle.count()) {
    const box = await resizeHandle.boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + 120)
      await page.mouse.down()
      await page.mouse.move(264, box.y + 120, { steps: 6 })
      await page.mouse.up()
      await page.waitForTimeout(400)
    }
  }
  const narrowMetrics = await page.evaluate(() => {
    const root = document.querySelector('.dsg-root')
    const header = root?.querySelector('.dsg-header-label')
    return {
      rootScroll: root?.scrollWidth ?? 0,
      rootClient: root?.clientWidth ?? 0,
      headerScroll: header?.scrollWidth ?? 0,
      headerClient: header?.clientWidth ?? 0,
      overflow: (root?.scrollWidth ?? 0) > (root?.clientWidth ?? 0) + 2,
    }
  })
  console.log(`NARROW ${JSON.stringify(narrowMetrics)}`)
  await snap('04-rtl-narrow-264')
  await page.setViewportSize({ width: 1280, height: 900 })

  // Settings/config surface, reached through the English host route.
  await setLocale('en')
  await page.evaluate(() => [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Plugins')?.click())
  await page.waitForTimeout(1500)
  const packageRow = page.locator('[data-plugin-package="dsh-session-grove"]').first()
  await packageRow.waitFor({ state: 'visible', timeout: 15_000 })
  await packageRow.click()
  await page.waitForTimeout(1200)
  const settingsPanel = page.locator('[data-testid="session-groups-settings-panel"]').first()
  await settingsPanel.waitFor({ state: 'visible', timeout: 15_000 })
  await setLocale('ar')
  await page.waitForTimeout(800)
  const settingsMetrics = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="session-groups-settings-panel"]')
    return {
      dir: panel?.getAttribute('dir') ?? null,
      title: panel?.innerText?.slice(0, 120) ?? '',
      scroll: panel?.scrollWidth ?? 0,
      client: panel?.clientWidth ?? 0,
    }
  })
  console.log(`SETTINGS ${JSON.stringify(settingsMetrics)}`)
  await snap('05-rtl-settings')

  if (pageErrors.length > 0) console.log(`PAGE_ERRORS ${JSON.stringify(pageErrors)}`)
  console.log(`OUTPUT_DIR ${outputDir}`)
} finally {
  await context.close()
  await browser.close()
}
