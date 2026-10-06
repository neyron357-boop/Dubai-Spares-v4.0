import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = new URL(process.env.APP_PUBLIC_URL);
if (!base.pathname.endsWith('/')) base.pathname += '/';
const expected = JSON.parse(await readFile('dist/offline-assets.json', 'utf8')).sort();
let publishedAssets;
for (let attempt = 0; attempt < 8; attempt++) {
  const url = new URL('offline-assets.json', base);
  url.searchParams.set('verify', process.env.GITHUB_SHA || String(Date.now()));
  try {
    const response = await fetch(url);
    if (response.ok) {
      publishedAssets = (await response.json()).sort();
      if (JSON.stringify(publishedAssets) === JSON.stringify(expected)) break;
    }
  } catch {
    // The deployment can take a moment to reach the public edge.
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
assert.deepEqual(publishedAssets, expected, 'The public site must serve this build');
await mkdir('deploy-smoke', { recursive: true });

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  const externalRequests = [];
  const badAssets = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && url.origin !== base.origin) {
      externalRequests.push(url.origin);
    }
  });
  page.on('response', (response) => {
    if (/\/assets\//.test(response.url()) && response.status() >= 400) {
      badAssets.push(response.status());
    }
  });

  const first = await page.goto(base.href + '#/orders');
  assert.equal(first.status(), 200);
  await page.getByRole('heading', { name: 'Заказы', exact: true }).waitFor();
  await page.waitForFunction(
    async () =>
      Boolean((await navigator.serviceWorker.ready).active && navigator.serviceWorker.controller),
    undefined,
    { timeout: 45000 },
  );
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('heading', { name: 'Заказы', exact: true }).waitFor();
  await page
    .getByRole('navigation', { name: 'Мобильная навигация' })
    .getByRole('link', { name: 'Настройки', exact: true })
    .click();
  await page.getByRole('heading', { name: 'Настройки', exact: true }).waitFor();
  await context.setOffline(false);

  const routes = [
    ['orders', 'Заказы'],
    ['new', 'Новый заказ'],
    ['database', 'Поставщики'],
    ['variants', 'Варианты'],
    ['notifications', 'Уведомления'],
    ['settings', 'Настройки'],
    ['request', /Найдём нужные/],
    ['trust', 'Безопасная покупка автозапчастей из Дубая'],
    ['q/missing', 'Смета недоступна'],
  ];
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: width < 900 ? 844 : 1000 });
    for (const [route, heading] of routes) {
      await page.goto(base.href + '#/' + route);
      await page.getByRole('heading', { name: heading, level: 1, exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        route + ' overflows at ' + width,
      );
      await page.screenshot({
        path: 'deploy-smoke/' + width + '-' + route.replaceAll('/', '-') + '.png',
      });
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(badAssets, []);
  console.log(
    JSON.stringify({
      status: 200,
      publishedAssetsMatch: true,
      viewportChecks: 27,
      offlineReload: true,
      offlineUnvisitedSettings: true,
      errors,
      externalRequests,
      badAssets,
    }),
  );
} finally {
  await browser.close();
}
