import { expect, test } from '@playwright/test';

test('production app precaches unvisited screens and reloads without internet', async ({
  page,
  context,
}) => {
  const external: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && url.hostname !== 'localhost')
      external.push(request.url());
  });
  await page.goto('/#/orders');
  await expect(page.getByRole('heading', { name: 'Заказы', exact: true })).toBeVisible();
  await page.waitForFunction(async () =>
    Boolean((await navigator.serviceWorker.ready).active && navigator.serviceWorker.controller),
  );
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Заказы', exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Основная навигация' })
    .getByRole('link', { name: 'Настройки', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Основная навигация' })
    .getByRole('link', { name: 'Новый', exact: true })
    .click();
  await expect(page.locator('form#new-order-form')).toBeVisible();
  await page.getByRole('button', { name: 'Марка', exact: true }).click();
  const dropdown = page
    .locator('div.absolute')
    .filter({ has: page.locator('input') })
    .last();
  await dropdown.locator('input').fill('Toyota');
  await dropdown.locator('button').first().click();
  await page.getByPlaceholder('Введите модель').fill('Camry');
  await page.getByPlaceholder('Введите модель').press('Enter');
  await page.getByRole('button', { name: 'Год', exact: true }).click();
  const years = page
    .locator('div.absolute')
    .filter({ has: page.locator('input') })
    .last();
  await years.locator('input').fill('2020');
  await years.locator('button').first().click();
  await page.locator('input[name="clientName"]').fill('Offline Buyer');
  await page.locator('form#new-order-form button[type="submit"]').click();
  await page.waitForURL(/#\/order\//);
  await expect(page.getByText('Toyota', { exact: false }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Toyota', { exact: false }).first()).toBeVisible();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('an update preserves previous build chunks for tabs opened before deployment', async ({
  page,
  context,
}) => {
  await page.goto('/icon-32.png');
  await page.evaluate(async () => {
    const cache = await caches.open('dubai-spares-local-v12');
    await cache.put(
      new URL('/assets/previous-build-7f4a2b.js', location.origin),
      new Response('export const previousBuild = true;', {
        headers: { 'Content-Type': 'application/javascript' },
      }),
    );
  });
  await page.goto('/#/orders');
  await expect(page.getByRole('heading', { name: 'Заказы', exact: true })).toBeVisible();
  await page.waitForFunction(async () =>
    Boolean((await navigator.serviceWorker.ready).active && navigator.serviceWorker.controller),
  );
  await context.setOffline(true);
  const previous = await page.evaluate(async () => {
    const response = await fetch('/assets/previous-build-7f4a2b.js');
    return { status: response.status, body: await response.text() };
  });
  expect(previous).toEqual({ status: 200, body: 'export const previousBuild = true;' });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Заказы', exact: true })).toBeVisible();
});
