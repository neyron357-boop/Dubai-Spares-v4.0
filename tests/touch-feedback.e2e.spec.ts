import { devices, expect, test } from '@playwright/test';

test.use({ ...devices['iPhone 13'], defaultBrowserType: 'chromium' });

const scaleOf = (locator: import('@playwright/test').Locator) =>
  locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).scale) || 1);

test('a held touch sinks a control, release springs past rest, and scrolling never presses', async ({
  page,
  context,
}) => {
  await page.goto('/#/orders');
  const tab = page.locator('.app-bottom-nav').getByRole('link', { name: 'Поставщики' });
  const box = (await tab.boundingBox())!;
  const touch = await context.newCDPSession(page);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await expect.poll(() => scaleOf(tab)).toBeLessThan(0.97);
  await expect(tab).toHaveAttribute('data-pressed', '');

  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  let peak = 0;
  for (let frame = 0; frame < 12; frame++) {
    peak = Math.max(peak, await scaleOf(tab));
    await page.waitForTimeout(30);
  }
  expect(peak).toBeGreaterThan(1);
  await expect.poll(() => scaleOf(tab)).toBe(1);
  await expect(page).toHaveURL(/#\/database$/);
  await expect(page.locator('.app-nav-indicator')).toHaveCSS('translate', '100%');

  const create = page.locator('.app-bottom-nav').getByRole('link', { name: 'Новый' });
  const start = (await create.boundingBox())!;
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: start.x + 20, y: start.y + 20 }],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: start.x + 20, y: start.y - 40 }],
  });
  await page.waitForTimeout(120);
  await expect(page.locator('[data-pressed]')).toHaveCount(0);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
});

test('reduced motion keeps controls still', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/orders');
  const tab = page.locator('.app-bottom-nav').getByRole('link', { name: 'Варианты' });
  const box = (await tab.boundingBox())!;
  const touch = await context.newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
  });
  await page.waitForTimeout(150);
  expect(await scaleOf(tab)).toBe(1);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
});
