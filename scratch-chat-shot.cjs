const { chromium } = require('c:/Udaan/node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core')

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://localhost:5188/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await page.screenshot({ path: '/tmp/chat-before-collapsed.png' })

  await browser.close()
  console.log('done')
})()
