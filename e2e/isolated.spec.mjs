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

  // View options / archive tri-state: selecting a filter closes the popover and
  // persists the filter on the header button; restore the default afterwards.
  const filterButton = page.locator('[data-testid="session-groups-view-options"]').first()
  const initialFilter = await filterButton.getAttribute('data-filter')
  for (const filter of ['only', 'all', initialFilter ?? 'hidden']) {
    await page.evaluate(() => document.querySelector('[data-testid="session-groups-view-options"]')?.click())
    await page.locator('[data-testid="session-groups-view-options-popover"]').waitFor({ state: 'visible' })
    await page.evaluate((value) => {
      document.querySelector(`[data-testid="session-groups-archive-filter"][data-filter="${value}"]`)?.click()
    }, filter)
    await page.locator('[data-testid="session-groups-view-options-popover"]').waitFor({ state: 'hidden' })
    await page.waitForTimeout(250)
    const currentFilter = await filterButton.getAttribute('data-filter')
    if (currentFilter !== filter) throw new Error(`archive filter expected ${filter}, got ${currentFilter}`)
  }

  // Dragging an outside session over a collapsed target must auto-expand it.
  const dragRootId = await createGroup(`Drag ${suffix}`)
  await addSessionToGroup(dragRootId)
  const dragSessionId = groupSessionIds(dragRootId)[0]
  if (!dragSessionId) throw new Error('drag source session was not created')
  const targetRowForDrag = groupRowById(targetId)
  await targetRowForDrag.click({ force: true })
  await page.waitForTimeout(300)
  if ((await targetRowForDrag.getAttribute('aria-expanded')) !== 'false') throw new Error('target did not collapse for drag')
  await page.evaluate(({ sourceId, targetId }) => {
    const source = document.querySelector(`[data-testid="session-groups-session"][data-session-id="${sourceId}"]`)
    const target = document.querySelector(`[data-testid="session-groups-group"][data-group-id="${targetId}"]`)
    if (!source || !target) throw new Error('drag rows missing')
    const dt = new DataTransfer()
    window.__dsgTestTransfer = dt
    window.__dsgTestSource = source
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
    const rect = target.getBoundingClientRect()
    for (const type of ['dragenter', 'dragover']) {
      target.dispatchEvent(new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }))
    }
  }, { sourceId: dragSessionId, targetId })
  await page.waitForTimeout(850)
  if ((await targetRowForDrag.getAttribute('aria-expanded')) !== 'true') throw new Error('collapsed target did not auto-expand on drag hover')
  await page.evaluate(() => {
    window.__dsgTestSource?.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: window.__dsgTestTransfer }))
    window.__dsgTestSource = null
    window.__dsgTestTransfer = null
  })

  // Group header edge zones: top and bottom must produce the before/after
  // placeholders and must not commit without a drop.
  for (const edge of [
    { ratio: 0.2, kind: 'group-before' },
    { ratio: 0.8, kind: 'group-after' },
  ]) {
    await page.evaluate(({ sourceId, targetId, ratio }) => {
      const source = document.querySelector(`[data-testid="session-groups-group"][data-group-id="${sourceId}"]`)
      const target = document.querySelector(`[data-testid="session-groups-group"][data-group-id="${targetId}"]`)
      if (!source || !target) throw new Error('edge drag rows missing')
      const dt = new DataTransfer()
      window.__dsgEdgeTransfer = dt
      window.__dsgEdgeSource = source
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
      const rect = target.getBoundingClientRect()
      target.dispatchEvent(new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + Math.max(2, rect.height * ratio),
      }))
    }, { sourceId: dragRootId, targetId, ratio: edge.ratio })
    await page.waitForTimeout(250)
    const kind = await page.locator('[data-testid="session-groups-drop-indicator"]').getAttribute('data-drop-kind')
    if (kind !== edge.kind) throw new Error(`edge ${edge.ratio} expected ${edge.kind}, got ${kind}`)
    await page.evaluate(() => {
      window.__dsgEdgeSource?.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: window.__dsgEdgeTransfer }))
      window.__dsgEdgeSource = null
      window.__dsgEdgeTransfer = null
    })
    await page.waitForTimeout(250)
  }

  // Dialog geometry and backdrop policy: titlebar drag moves, backdrop click
  // leaves the dialog open, and the resize handle changes its size.
  await page.evaluate(() => document.querySelector('[data-testid="session-groups-new-group"]')?.click())
  const dialog = page.locator('[data-testid="session-groups-dialog"]')
  await dialog.waitFor({ state: 'visible' })
  const dialogBefore = await dialog.boundingBox()
  const titlebar = page.locator('.dsg-dialog-titlebar').first()
  const titleBox = await titlebar.boundingBox()
  if (!dialogBefore || !titleBox) throw new Error('dialog geometry missing')
  await page.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(titleBox.x + titleBox.width / 2 + 50, titleBox.y + titleBox.height / 2 + 25, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  const dialogMoved = await dialog.boundingBox()
  if (!dialogMoved || (Math.abs(dialogMoved.x - dialogBefore.x) < 10 && Math.abs(dialogMoved.y - dialogBefore.y) < 10)) {
    throw new Error(`dialog did not move: ${JSON.stringify({ dialogBefore, dialogMoved })}`)
  }
  await page.evaluate(() => document.querySelector('.dsg-dialog-backdrop')?.click())
  await page.waitForTimeout(250)
  if ((await dialog.count()) !== 1) throw new Error('backdrop click must not close the dialog')
  const resizer = page.locator('.dsg-dialog-resizer').first()
  const resizeBox = await resizer.boundingBox()
  if (!resizeBox) throw new Error('dialog resizer missing')
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 35, resizeBox.y + resizeBox.height / 2 + 25, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  const dialogResized = await dialog.boundingBox()
  if (!dialogResized || (Math.abs(dialogResized.width - dialogMoved.width) < 5 && Math.abs(dialogResized.height - dialogMoved.height) < 5)) {
    throw new Error(`dialog did not resize: ${JSON.stringify({ dialogMoved, dialogResized })}`)
  }
  await page.evaluate(() => document.querySelector('[data-testid="session-groups-dialog-cancel"]')?.click())
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
  const collapsedLayout = await page.evaluate(() => ({
    rootWidth: document.querySelector('[data-dsg-sidebar-root]')?.getBoundingClientRect().width ?? null,
    railWidth: document.querySelector('[data-testid="session-groups-rail"]')?.getBoundingClientRect().width ?? null,
    widthOverride: document.querySelector('[data-dsg-width]')?.textContent ?? null,
  }))
  if (collapsedLayout.rootWidth > 64 || collapsedLayout.railWidth > 64) {
    throw new Error(`collapsed rail kept the wide sidebar: ${JSON.stringify(collapsedLayout)}`)
  }
  if (collapsedLayout.widthOverride !== null) {
    throw new Error(`collapsed rail kept the width override: ${collapsedLayout.widthOverride}`)
  }
  const expand = page.locator('[data-testid="session-groups-rail-expand"]').first()
  if ((await expand.count()) > 0) await page.evaluate(() => document.querySelector('[data-testid="session-groups-rail-expand"]')?.click())
  await page.waitForTimeout(800)
  await groupView.waitFor({ state: 'visible' })

  // Native-tool/HTTP commits are Host-side writes. The sidebar must invalidate
  // its local snapshot through the revision SSE stream instead of waiting for
  // a page reload.
  const externalRename = (name) =>
    page.evaluate(async (nextName) => {
      const loaded = await fetch('/dsh-session-groups/load').then((response) => response.json())
      const doc = loaded.doc
      if (!Array.isArray(doc?.groups) || doc.groups.length === 0) throw new Error('no group for external commit')
      doc.groups[0].name = nextName
      const response = await fetch('/dsh-session-groups/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: loaded.revision, doc }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(`external commit failed: ${response.status} ${JSON.stringify(body)}`)
      return body.revision
    }, name)

  const liveName = `SSE 外部刷新 ${Date.now()}`
  await externalRename(liveName)
  await page.waitForFunction((name) => document.body.innerText.includes(name), liveName, { timeout: 6000 })

  // Switching to the shipped workspace and back must reload the Host snapshot,
  // even if the SSE event arrived while the groups slot was unmounted.
  const modeToggle = page.locator('[data-testid="session-groups-toggle"]').first()
  if ((await modeToggle.count()) !== 1) throw new Error('groups mode toggle missing for workspace round-trip')
  await page.evaluate(() => document.querySelector('[data-testid="session-groups-toggle"]')?.click())
  await page.waitForTimeout(600)
  const hiddenName = `切换刷新 ${Date.now()}`
  await externalRename(hiddenName)
  const backToggle = page.locator('[data-testid="session-groups-workspace-toggle"]').first()
  if ((await backToggle.count()) !== 1) throw new Error('workspace overlay toggle missing for return')
  await page.evaluate(() => document.querySelector('[data-testid="session-groups-workspace-toggle"]')?.click())
  await page.waitForTimeout(1000)
  await page.waitForFunction((name) => document.body.innerText.includes(name), hiddenName, { timeout: 6000 })

  // Rapid successive external revisions must converge on the newest snapshot.
  const rapidBase = `快速刷新 ${Date.now()}`
  await externalRename(`${rapidBase}-1`)
  await externalRename(`${rapidBase}-2`)
  await page.waitForFunction((name) => document.body.innerText.includes(name), `${rapidBase}-2`, { timeout: 6000 })

  // Session actions must preserve the official core set: no no-op pin item,
  // plus fork/copy ID and a hover archive control.
  const sessionMenuButton = page.locator('[data-testid="session-groups-session-menu"]').first()
  if ((await sessionMenuButton.count()) === 0) throw new Error('session menu button missing')
  await sessionMenuButton.click({ force: true })
  const menuText = await page.locator('[data-testid="session-groups-menu"]').innerText()
  if (!/Copy Session ID/i.test(menuText)) {
    throw new Error(`session menu missing Copy Session ID: ${menuText}`)
  }
  // Fork is access/blank gated like the official menu; its absence on a blank
  // session is correct. The action/placement path is covered by unit tests.
  if (/^(?:Pin|Unpin)$/im.test(menuText)) throw new Error(`session menu still exposes pin: ${menuText}`)
  await page.keyboard.press('Escape')
  const hoverArchive = page.locator('[data-testid="session-groups-session-archive"]').first()
  if ((await hoverArchive.count()) === 0) throw new Error('session hover archive control missing')

  // Settings must be on the package detail page, use DSH switches and expose a
  // standard click-pinned tooltip with the long-form risk/usage copy.
  await page.evaluate(() => [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Plugins')?.click())
  await page.waitForTimeout(700)
  const packageRow = page.locator('[data-plugin-package="dsh-session-groups"]').first()
  await packageRow.waitFor({ state: 'visible', timeout: 5000 })
  await packageRow.click()
  await page.waitForTimeout(1200)
  const settingsPanel = page.locator('[data-testid="session-groups-settings-panel"]').first()
  if ((await settingsPanel.count()) === 0) throw new Error('settings panel is not on the package detail page')
  const pluginHead = await page.locator('[data-plugin-detail="dsh-session-groups"]').innerText()
  if (!/Free groups/.test(pluginHead)) throw new Error(`localized plugin title missing: ${pluginHead.slice(0, 120)}`)
  if ((await page.locator('[role="switch"]').count()) < 5) throw new Error('settings switches are missing')
  const infoButton = page.locator('.dsg-config-info').first()
  if ((await infoButton.count()) === 0) throw new Error('configuration details button missing')
  await infoButton.click()
  await page.waitForTimeout(300)
  const detailsText = await page.locator('[role="tooltip"]').first().innerText()
  if (!/What it does:/i.test(detailsText) || !/Security:/i.test(detailsText)) {
    throw new Error(`configuration details tooltip is incomplete: ${detailsText.slice(0, 300)}`)
  }
  await page.keyboard.press('Escape')
  const configSwitch = page.locator('[data-testid="session-groups-config-diagnostics"] [role="switch"]').first()
  const switchBefore = await configSwitch.getAttribute('aria-checked')
  await configSwitch.click()
  await page.waitForTimeout(400)
  const switchAfter = await configSwitch.getAttribute('aria-checked')
  if (switchBefore === switchAfter) throw new Error('standard settings switch did not toggle')
  await configSwitch.click()
  await page.waitForTimeout(300)

  console.log('PASS: isolated onboarding, search, archive filter, drag auto-expand, group edges, dialog geometry, status buttons, head insertion, collapse/expand, 264px, dark, host rail, external SSE refresh, workspace round-trip refresh, rapid revision convergence, session actions, first-layer settings, localized title, option details and switch interaction')
} catch (error) {
  await screenshot()
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await context.close().catch(() => {})
  await browser.close().catch(() => {})
}





