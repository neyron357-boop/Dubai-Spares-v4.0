import { expect, Page, test } from '@playwright/test';

const SUPABASE_REQUEST = /https:\/\/[^/]*supabase\.co\/.*/;

async function blockSupabase(page: Page) {
  await page.route(SUPABASE_REQUEST, (route) => route.abort('blockedbyclient'));
}

function captureFatalUiErrors(page: Page) {
  const fatal: string[] = [];
  page.on('pageerror', (error) => fatal.push(error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (
      message.type() === 'error'
      && /Rendered more hooks|React has detected a change in the order of Hooks|Uncaught Error|Hydration/i.test(text)
    ) {
      fatal.push(text);
    }
  });
  return fatal;
}

test('direct missing order route renders a non-empty state instead of a white screen', async ({ page }) => {
  await blockSupabase(page);
  const fatal = captureFatalUiErrors(page);

  await page.goto('/#/order/qa-missing-order', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status')).toContainText('Загрузка заказа', { timeout: 8_000 });

  const rootState = await page.evaluate(() => ({
    bodyTextLength: document.body.innerText.length,
    rootChildren: document.getElementById('root')?.children.length || 0
  }));

  expect(rootState.bodyTextLength).toBeGreaterThan(0);
  expect(rootState.rootChildren).toBeGreaterThan(0);
  expect(fatal).toEqual([]);
});

test('hash public request route can navigate to NotFound without stale public form', async ({ page }) => {
  await blockSupabase(page);
  const fatal = captureFatalUiErrors(page);

  await page.goto('/#/request', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).toContainText('Stark Motors Concierge', { timeout: 8_000 });

  await page.evaluate(() => {
    window.location.hash = '#/does-not-exist';
  });

  await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('#root')).not.toContainText('Stark Motors Concierge');
  expect(fatal).toEqual([]);
});
