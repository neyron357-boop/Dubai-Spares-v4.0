import { expect, test } from '@playwright/test';

test('all local screens load without external requests, errors or permission prompts', async ({
  page,
}) => {
  const requests: string[] = [],
    errors: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && !['localhost', '127.0.0.1'].includes(url.hostname))
      requests.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = () => {
      throw new Error('Unrequested location permission');
    };
  });
  for (const [route, title] of [
    ['orders', 'Заказы'],
    ['database', 'Поставщики'],
    ['variants', 'Варианты'],
    ['settings', 'Настройки'],
    ['new', 'Новый заказ'],
    ['request', 'Введите данные автомобиля'],
  ] as const) {
    await page.goto(`/#/${route}`);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(
      page.getByText(/Ошибка загрузки поставщиков|Cloud is|Supabase|подключения к серверу/),
    ).toHaveCount(0);
  }
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test('public request saves a lead locally and downloads a transferable file', async ({ page }) => {
  await page.goto('/#/request');
  await page.getByLabel('Марка *', { exact: true }).selectOption('Toyota');
  await page.getByLabel('Модель *', { exact: true }).fill('Camry');
  await page.getByLabel('Год выпуска *', { exact: true }).selectOption('2020');
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByLabel('Деталь 1', { exact: true }).fill('Передний бампер');
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByLabel('Имя *', { exact: true }).fill('Local Request User');
  await page.getByLabel('Телефон или WhatsApp *', { exact: true }).fill('+971501234567');
  await page.getByRole('button', { name: 'Сохранить заявку' }).click();
  await expect(page.getByRole('heading', { name: 'Заявка сохранена' })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать заявку' }).click();
  const { readFile } = await import('node:fs/promises');
  const data = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
  expect(data.orders[0]).toMatchObject({
    clientName: 'Local Request User',
    leadSource: 'public_form',
    parts: [{ name: 'Передний бампер' }],
  });
  await page.getByRole('button', { name: 'Открыть заказы' }).click();
  await page.getByRole('button', { name: /^Интерес/ }).click();
  await expect(page.locator('article').filter({ hasText: 'Toyota Camry' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /^Интерес/ }).click();
  await expect(page.locator('article').filter({ hasText: 'Toyota Camry' })).toBeVisible();
});

test('invalid backup cannot overwrite data and restore dialog supports keyboard dismissal', async ({
  page,
}) => {
  await page.goto('/#/settings');
  await page.getByRole('tab', { name: 'Система', exact: true }).click();
  const input = page.getByText('Восстановить из файла', { exact: true }).locator('input');
  await input.setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"orders":[{"id":"bad"}]}'),
  });
  await expect(page.getByRole('alert')).toContainText('повреждённые заказы');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await input.setInputFiles({
    name: 'valid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"orders":[]}'),
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
});

test('mobile navigation has readable labels and works with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/orders');
  const nav = page.getByRole('navigation', { name: 'Мобильная навигация' });
  for (const label of ['Заказы', 'Поставщики', 'Новый', 'Варианты', 'Настройки']) {
    const link = nav.getByRole('link', { name: label, exact: true });
    await expect(link).toBeVisible();
    const bounds = await link.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }
  await nav.getByRole('link', { name: 'Настройки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Настройки', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});
