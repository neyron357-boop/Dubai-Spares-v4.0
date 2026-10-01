import { expect, type Page, test } from '@playwright/test';
const orderId = '10000000-0000-4000-8000-000000000001';
const partId = '20000000-0000-4000-8000-000000000001';
const firstOfferId = '30000000-0000-4000-8000-000000000001';
const route = `/#/order/${orderId}/part/${partId}`;
async function seed(page: Page, paid = true) {
  await page.goto('/#/orders');
  await expect(page.getByRole('heading', { name: 'Заказы', exact: true })).toBeVisible();
  await page.evaluate(
    async ({ orderId, partId, firstOfferId, paid }) => {
      const photo =
        'data:image/svg+xml,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#e8eef8"/><rect x="70" y="180" width="660" height="130" rx="40" fill="#34465d"/></svg>',
        );
      const offerPhoto = photo.replace('e8eef8', 'fdf0dc');
      const order = {
        id: orderId,
        brand: 'BMW',
        model: '3 Series',
        year: '2017',
        vin: 'WBA8E91090A123456',
        bodyType: 'Седан',
        clientName: 'Part QA',
        parts: [
          {
            id: partId,
            name: 'FR BUMPER',
            comment: 'Передний бампер M Sport.',
            photos: [photo],
            photoUrl: photo,
            status: 'found',
            isFound: true,
            variants: [
              {
                id: firstOfferId,
                shopName: 'Al Noor Parts',
                purchasePriceAed: 450.5,
                priceAed: 520,
                salePriceAed: 520,
                phone: '+971501234567',
                locationText: 'Industrial Area 6, Sharjah',
                condition: 'used',
                availability: 'in_stock',
                photos: [offerPhoto],
                createdAt: Date.now(),
              },
              {
                id: '30000000-0000-4000-8000-000000000002',
                shopName: 'Dubai BMW Parts',
                purchasePriceAed: 680,
                priceAed: 680,
                phone: '',
                condition: 'new',
                availability: 'by_order',
                createdAt: Date.now() - 1000,
              },
            ],
          },
        ],
        status: 'in_progress',
        paymentStatus: paid ? 'search_deposit_paid' : 'none',
        searchDepositStatus: paid ? 'paid' : 'unpaid',
        priority: 'medium',
        source: 'WhatsApp',
        createdAt: Date.now(),
        carPhotos: [],
        notes: [],
        exchangeRate: 3.67,
        markupPercent: 15,
      };
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('dubai-spares-offline');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('orders', 'readwrite');
        tx.objectStore('orders').put(order);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { orderId, partId, firstOfferId, paid },
  );
  await page.goto(route);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'FR BUMPER', exact: true })).toBeVisible();
}
async function readPart(page: Page) {
  return page.evaluate(
    async ({ orderId, partId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('dubai-spares-offline');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const order = await new Promise<{ parts: Array<Record<string, any>> }>((resolve, reject) => {
        const req = db.transaction('orders', 'readonly').objectStore('orders').get(orderId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return order.parts.find((part) => part.id === partId)!;
    },
    { orderId, partId },
  );
}

test('reference photos stay separate and the cheapest offer is not automatically selected', async ({
  page,
}) => {
  await seed(page);
  await expect(page.locator('.part-detail-photo-count')).toHaveText('1 / 1');
  await expect(page.locator('.part-detail-offer-summary')).toContainText('Не выбран');
  await expect(page.locator('.part-offer-card.is-selected')).toHaveCount(0);
  const first = page.getByRole('article', { name: 'Вариант от Al Noor Parts', exact: true });
  await expect(first).toContainText('Минимальная цена');
  await expect(first).toContainText('450,50 AED');
  await expect(
    page
      .getByRole('article', { name: 'Вариант от Dubai BMW Parts', exact: true })
      .getByRole('button', { name: 'WhatsApp', exact: true }),
  ).toBeDisabled();
  await first.getByRole('button', { name: 'Выбрать', exact: true }).click();
  await expect.poll(async () => (await readPart(page)).bestOfferId).toBe(firstOfferId);
  await expect(first.getByRole('button', { name: 'Выбрано', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await first.getByRole('button', { name: 'Выбрано', exact: true }).click();
  await expect.poll(async () => (await readPart(page)).bestOfferId).toBeUndefined();
  await page.reload();
  await expect(page.locator('.part-offer-card.is-selected')).toHaveCount(0);
});

test('offer editor validates required fields, saves decimals and asks before discarding edits', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('button', { name: 'Добавить вариант', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Добавить вариант', exact: true });
  await editor.getByRole('combobox', { name: 'Название поставщика', exact: true }).fill('');
  await editor.getByRole('button', { name: 'Сохранить вариант', exact: true }).click();
  await expect(
    editor.getByRole('textbox', { name: 'Цена закупки, AED', exact: true }),
  ).toBeFocused();
  await expect(editor.getByText('Введите цену больше нуля.', { exact: true })).toBeVisible();
  await editor.getByRole('textbox', { name: 'Цена закупки, AED', exact: true }).fill('500,75');
  await editor
    .getByRole('combobox', { name: 'Название поставщика', exact: true })
    .fill('New Decimal Parts');
  await editor.getByRole('button', { name: 'Отмена', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Закрыть без сохранения?', exact: true });
  await discard.getByRole('button', { name: 'Продолжить заполнение', exact: true }).click();
  await expect(editor.getByRole('textbox', { name: 'Цена закупки, AED', exact: true })).toHaveValue(
    '500.75',
  );
  await editor.getByRole('textbox', { name: 'Телефон', exact: true }).fill('');
  await editor.getByRole('checkbox', { name: /Выбрать этот вариант/ }).check();
  await editor.getByRole('button', { name: 'Сохранить вариант', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const part = await readPart(page);
  expect(part.variants).toHaveLength(3);
  expect(part.variants[0]).toMatchObject({
    purchasePriceAed: 500.75,
    phone: '',
    shopName: 'New Decimal Parts',
    isBest: true,
  });
  expect(part.bestOfferId).toBe(part.variants[0].id);
});

test('failed description save retains changes and cancellation keeps the saved description', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('button', { name: 'Изменить описание детали', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Описание детали', exact: true });
  await editor.getByRole('textbox', { name: 'Описание детали', exact: true }).fill('Новая заметка');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as unknown as { restoreWrites: () => void }).restoreWrites = () => {
      IDBObjectStore.prototype.put = put;
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'orders') throw new DOMException('Full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await editor.getByRole('button', { name: 'Сохранить описание', exact: true }).click();
  await expect(
    editor.getByText('Описание не сохранилось. Данные остались в форме.', { exact: true }),
  ).toBeVisible();
  await expect(editor.getByRole('textbox', { name: 'Описание детали', exact: true })).toHaveValue(
    'Новая заметка',
  );
  await page.evaluate(() => (window as unknown as { restoreWrites: () => void }).restoreWrites());
  await editor.getByRole('button', { name: 'Сохранить описание', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect((await readPart(page)).comment).toBe('Новая заметка');
  await page.getByRole('button', { name: 'Изменить описание детали', exact: true }).click();
  await editor.getByRole('textbox', { name: 'Описание детали', exact: true }).fill('Не сохранять');
  await editor.getByRole('button', { name: 'Отмена', exact: true }).click();
  expect((await readPart(page)).comment).toBe('Новая заметка');
});

test('deposit restriction is explained and mobile actions do not cover the last offer', async ({
  page,
}) => {
  await seed(page, false);
  await expect(
    page.getByText('Подтвердите депозит в заказе, чтобы добавлять варианты.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить вариант', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Из базы данных', exact: true })).toBeDisabled();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    const edit = page.getByRole('button', {
      name: 'Редактировать вариант от Dubai BMW Parts',
      exact: true,
    });
    await edit.scrollIntoViewIfNeeded();
    expect(
      await edit.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
        );
      }),
    ).toBe(true);
  }
});

test('returning from a part restores the order tab once and allows later tab changes', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  const card = page.locator('article[role="button"]').filter({ hasText: 'FR BUMPER' });
  await card.click();
  await page.waitForURL(/\/part\//);
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Поиск', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Материалы', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Материалы', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Заметки', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
