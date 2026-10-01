import { expect, test } from '@playwright/test';
import { selectVehicle } from './helpers/vehicle';

test('vehicle picker handles search, manual models, dependent values and keyboard cancellation', async ({
  page,
}) => {
  await page.goto('/#/new');
  const brand = page.getByRole('button', { name: 'Марка', exact: true });
  await brand.click();
  const picker = page.getByRole('dialog', { name: 'Выберите: Марка', exact: true });
  await picker.getByRole('combobox').fill('NoSuchBrand');
  await expect(picker.getByText('Ничего не найдено', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(brand).toBeFocused();
  await selectVehicle(page, 'Марка', 'Toyota');
  await selectVehicle(page, 'Модель', 'Custom touring model');
  await expect(page.getByRole('button', { name: 'Модель', exact: true })).toHaveText(
    'Custom touring model',
  );
  await selectVehicle(page, 'Год', '2020');
  await selectVehicle(page, 'Кузов', 'Седан');
  await page.getByRole('textbox', { name: 'Имя клиента', exact: true }).fill('Александр');
  await expect(
    page.getByRole('heading', { name: 'Всё готово к созданию', exact: true }),
  ).toBeVisible();
  await selectVehicle(page, 'Марка', 'BMW');
  await expect(page.getByRole('button', { name: 'Модель', exact: true })).toHaveText(
    'Выберите или введите',
  );
  await expect(page.getByRole('button', { name: 'Кузов', exact: true })).toHaveText('Не указан');
  await expect(page.getByRole('button', { name: 'Год', exact: true })).toHaveText('2020');
  await expect(page.getByRole('textbox', { name: 'Имя клиента', exact: true })).toHaveValue(
    'Александр',
  );
});

test('clearing a draft can be cancelled and the cleared form can save a fresh draft', async ({
  page,
}) => {
  await page.goto('/#/new');
  await selectVehicle(page, 'Марка', 'Toyota');
  await page.getByRole('button', { name: 'Очистить форму', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Очистить черновик?', exact: true });
  await confirm.getByRole('button', { name: 'Продолжить заполнение', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Марка', exact: true })).toHaveText('Toyota');
  await page.getByRole('button', { name: 'Очистить форму', exact: true }).click();
  await confirm.getByRole('button', { name: 'Очистить форму', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Марка', exact: true })).toHaveText(
    'Выберите марку',
  );
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('dubai_spares_draft_new_order_v1')))
    .toBeNull();
  await selectVehicle(page, 'Марка', 'BMW');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('dubai_spares_draft_new_order_v1') || 'null')?.data.brand,
      ),
    )
    .toBe('BMW');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Марка', exact: true })).toHaveText('BMW');
});

test('new-order fields and sheet stay usable on narrow screens and short viewports', async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 740 });
    await page.goto('/#/new');
    await expect(page.getByRole('heading', { name: 'Новый заказ', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    const heights = await page
      .locator('.vehicle-field-trigger')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(heights).toEqual([52, 52, 52, 52]);
    const submit = page.getByRole('button', { name: 'Создать заказ', exact: true });
    await submit.scrollIntoViewIfNeeded();
    expect(
      await submit.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
        );
      }),
    ).toBe(true);
    await page.getByRole('button', { name: 'Год', exact: true }).click();
    const years = page.getByRole('dialog', { name: 'Выберите: Год', exact: true });
    await expect(years).toBeVisible();
    await page.setViewportSize({ width, height: 440 });
    const oldest = years.getByRole('option', { name: '1980', exact: true });
    await oldest.scrollIntoViewIfNeeded();
    await oldest.click();
    await expect(page.getByRole('button', { name: 'Год', exact: true })).toHaveText('1980');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  }
});

test('a storage failure preserves the form and retry saves exactly one order', async ({ page }) => {
  await page.goto('/#/new');
  await selectVehicle(page, 'Марка', 'Toyota');
  await selectVehicle(page, 'Модель', 'Camry');
  await selectVehicle(page, 'Год', '2020');
  await page.getByRole('textbox', { name: 'Имя клиента', exact: true }).fill('Retry Buyer');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as unknown as { restoreOrderWrites: () => void }).restoreOrderWrites = () => {
      IDBObjectStore.prototype.put = put;
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'orders') throw new DOMException('Storage full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Создать заказ', exact: true }).click();
  const failure = page.locator('.new-order-save-error');
  await expect(failure).toBeVisible();
  await expect(failure).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Имя клиента', exact: true })).toHaveValue(
    'Retry Buyer',
  );
  await expect(page.getByRole('button', { name: 'Создать заказ', exact: true })).toBeEnabled();
  await page.evaluate(() =>
    (window as unknown as { restoreOrderWrites: () => void }).restoreOrderWrites(),
  );
  await page.getByRole('button', { name: 'Создать заказ', exact: true }).click();
  await page.waitForURL(/#\/order\//);
  const count = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('dubai-spares-offline');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const count = await new Promise<number>((resolve, reject) => {
      const req = db.transaction('orders', 'readonly').objectStore('orders').count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return count;
  });
  expect(count).toBe(1);
});
