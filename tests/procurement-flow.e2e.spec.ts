import { expect, Page, test } from '@playwright/test';

const SUPABASE_REQUEST = /https:\/\/[^/]*supabase\.co\/.*/;

const SAMPLE_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

type StoredOrder = Record<string, any>;

async function blockSupabase(page: Page) {
  await page.route(SUPABASE_REQUEST, (route) => route.abort('blockedbyclient'));
}

async function gotoHash(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

async function selectSearchableDropdown(page: Page, trigger: ReturnType<Page['locator']>, query: string) {
  await trigger.click();
  const dropdown = page.locator('div.absolute').filter({ has: page.locator('input') }).last();
  await expect(dropdown).toBeVisible();
  await dropdown.locator('input').fill(query);
  await dropdown.locator('button').first().click();
}

async function createOrderFromManualRequest(page: Page) {
  await gotoHash(page, '/#/new');
  await expect(page.locator('form#new-order-form')).toBeVisible();

  await selectSearchableDropdown(page, page.getByRole('button', { name: 'Марка' }), 'BMW');
  await page.getByPlaceholder('Введите модель').fill('X5');
  await page.getByPlaceholder('Введите модель').press('Enter');
  await selectSearchableDropdown(page, page.getByRole('button', { name: 'Год' }), '2018');

  await page.locator('input[name="clientName"]').fill('E2E Full Prepay Buyer');
  await page.locator('form#new-order-form button[type="submit"]').click();
  await page.waitForURL(/#\/order\//);

  const orderId = new URL(page.url()).hash.match(/#\/order\/([^/?]+)/)?.[1] || '';
  expect(orderId).toBeTruthy();
  return orderId;
}

async function readStoredOrder(page: Page, orderId: string): Promise<StoredOrder | null> {
  return await page.evaluate(async (targetOrderId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dubai-spares-offline');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    });

    const tx = db.transaction('orders', 'readonly');
    const order = await new Promise<Record<string, unknown> | null>((resolve, reject) => {
      const request = tx.objectStore('orders').get(targetOrderId);
      request.onsuccess = () => resolve((request.result as Record<string, unknown>) || null);
      request.onerror = () => reject(request.error ?? new Error('Failed to read order'));
    });

    db.close();
    return order;
  }, orderId);
}

async function patchStoredOrder(page: Page, orderId: string, patch: StoredOrder) {
  await page.evaluate(async ({ targetOrderId, patchValue }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dubai-spares-offline');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    });

    const tx = db.transaction('orders', 'readwrite');
    const store = tx.objectStore('orders');
    const order = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = store.get(targetOrderId);
      request.onsuccess = () => resolve(request.result as Record<string, unknown>);
      request.onerror = () => reject(request.error ?? new Error('Failed to read order'));
    });
    if (!order) throw new Error(`Order ${targetOrderId} was not found`);

    store.put({
      ...order,
      ...patchValue,
      updatedAt: Date.now()
    });

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to patch order'));
      tx.onabort = () => reject(tx.error ?? new Error('Patch transaction aborted'));
    });
    db.close();
  }, { targetOrderId: orderId, patchValue: patch });
}

test.describe('procurement workflow', () => {
  test.use({
    viewport: { width: 430, height: 920 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2
  });

  test('covers request to full-prepayment sourcing with supplier offer, proof, and notes', async ({ page }) => {
    await blockSupabase(page);

    const orderId = await createOrderFromManualRequest(page);

    await patchStoredOrder(page, orderId, {
      vin: 'WBAKS410100E2E123',
      customerContact: '+971501112233',
      carPhotoUrl: SAMPLE_IMAGE,
      carPhotos: [SAMPLE_IMAGE],
      vehicleDetails: {
        marketRegion: 'gcc',
        transmission: 'automatic',
        engineType: '3.0 petrol',
        color: 'black'
      }
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: 'Финансы' }).click();
    const depositSection = page.locator('section').filter({ has: page.getByRole('button', { name: 'Сохранить депозит' }) });
    await expect(depositSection).toBeVisible();
    await depositSection.locator('input[placeholder="0"]').first().fill('2500');
    await page.getByRole('button', { name: 'Сохранить депозит' }).click();

    await expect.poll(async () => (await readStoredOrder(page, orderId))?.paymentStatus).toBe('search_deposit_paid');

    await patchStoredOrder(page, orderId, {
      searchDepositStatus: 'paid',
      paymentStatus: 'full_prepayment_paid',
      salesStatus: 'Paid',
      status: 'in_progress'
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Полная предоплата')).toBeVisible();

    await page.getByRole('button', { name: 'Поиск', exact: true }).click();
    const addPartDock = page.locator('div.fixed:has(input[placeholder="Добавить деталь..."])').last();
    await addPartDock.locator('input[placeholder="Добавить деталь..."]').fill('Передний бампер M Sport');
    await addPartDock.getByRole('button', { name: 'Добавить деталь' }).click();

    const partCard = page.locator('article[role="button"]').filter({ hasText: 'Передний бампер M Sport' });
    await expect(partCard).toBeVisible();
    await partCard.click();
    await page.waitForURL(/#\/order\/[^/]+\/part\//);

    await page.getByRole('button', { name: 'Добавить вариант' }).click();
    const offerForm = page.locator('form').filter({ hasText: 'Добавить цену поставщика' });
    await expect(offerForm).toBeVisible();
    await offerForm.locator('input[placeholder="200"]').fill('520');
    await offerForm.getByPlaceholder('Поиск или новый магазин').fill('Sharjah BMW Used Parts');
    await offerForm.locator('input:not([type="file"])').nth(2).fill('+971501234567');
    await offerForm.getByPlaceholder('Ряд / зона / адрес').fill('Industrial Area 6, Sharjah');
    await offerForm.getByRole('button', { name: 'Разбор' }).click();
    await offerForm.getByRole('button', { name: 'Лучший вариант' }).click();
    await offerForm.getByPlaceholder('Комментарий для этого варианта').fill('Ответил в WhatsApp, деталь снята с машины, крепления целые.');
    await offerForm.getByRole('button', { name: 'Сохранить вариант' }).click();

    await expect(page.getByText('Вариант добавлен')).toBeVisible();
    await page.getByRole('button', { name: 'Вернуться к деталям' }).click();
    await page.waitForURL(new RegExp(`#/order/${orderId}$`));

    await page.getByRole('button', { name: 'Пруфы', exact: true }).click();
    await page.getByPlaceholder('Пруф клиенту: фото, цена, состояние...').fill('Поставщик подтвердил наличие, цена 520 AED, фото и карта готовы.');
    await page.getByRole('button', { name: 'Отправить пруф' }).click();
    await expect(page.getByText('Поставщик подтвердил наличие')).toBeVisible();

    await page.getByRole('button', { name: 'Заметки', exact: true }).click();
    await page.getByPlaceholder('Внутренняя заметка: что сказал клиент или поставщик...').fill('Внутренняя заметка: клиент оплатил полностью, можно ехать забирать после повторного звонка.');
    await page.getByRole('button', { name: 'Отправить заметку' }).click();
    await expect(page.getByText('Внутренняя заметка')).toBeVisible();

    const savedOrder = await readStoredOrder(page, orderId);
    expect(savedOrder?.paymentStatus).toBe('full_prepayment_paid');
    expect(savedOrder?.searchDepositAmount).toBe(2500);
    expect(savedOrder?.parts).toHaveLength(1);

    const savedPart = savedOrder?.parts[0];
    expect(savedPart).toMatchObject({
      name: 'Передний бампер M Sport',
      isFound: true,
      status: 'found'
    });
    expect(savedPart.variants).toHaveLength(1);
    expect(savedPart.variants[0]).toMatchObject({
      purchasePriceAed: 520,
      salePriceAed: 520,
      shopName: 'Sharjah BMW Used Parts',
      phone: '+971501234567',
      locationText: 'Industrial Area 6, Sharjah',
      condition: 'scrapyard',
      isBest: true
    });

    const notes = savedOrder?.notes || [];
    expect(notes.some((note: any) => note.kind === 'proof' && note.visibility === 'client' && note.text.includes('Поставщик подтвердил наличие'))).toBe(true);
    expect(notes.some((note: any) => note.kind !== 'proof' && note.text.includes('Внутренняя заметка'))).toBe(true);

    const suppliers = await page.evaluate(() => JSON.parse(localStorage.getItem('dubai_spares_suppliers') || '[]'));
    const supplier = suppliers.find((item: any) => item.name === 'Sharjah BMW Used Parts');
    expect(supplier).toBeTruthy();
    expect(supplier.phone).toBe('+971501234567');
    expect(supplier.linkedParts?.[0]).toMatchObject({
      orderId,
      partName: 'Передний бампер M Sport',
      status: 'found',
      source: 'variant',
      priceAed: 520
    });
  });
});
