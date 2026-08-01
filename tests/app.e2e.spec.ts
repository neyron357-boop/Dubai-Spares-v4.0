import { expect, Page, test } from '@playwright/test';

const SUPABASE_REQUEST = /https:\/\/[^/]*supabase\.co\/.*/;

async function loadPublicQuoteSnapshotNormalizer() {
  const storage = new Map<string, string>();
  const windowShim = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, String(value)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear()
    },
    addEventListener: () => undefined,
    dispatchEvent: () => true,
    setTimeout,
    clearTimeout
  };
  (globalThis as unknown as { window?: typeof windowShim }).window = windowShim;
  return await import('../utils/publicQuoteSnapshot');
}

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

function orderCard(page: Page, label: string) {
  return page.locator('article').filter({ hasText: label }).first();
}

async function createLocalOrder(page: Page, clientName: string) {
  await blockSupabase(page);
  await gotoHash(page, '/#/new');
  await expect(page.locator('form#new-order-form')).toBeVisible();

  await selectSearchableDropdown(page, page.getByRole('button', { name: 'Марка' }), 'Toyota');
  await page.getByPlaceholder('Введите модель').fill('Camry');
  await page.getByPlaceholder('Введите модель').press('Enter');
  await selectSearchableDropdown(page, page.getByRole('button', { name: 'Год' }), '2020');

  await page.locator('input[name="clientName"]').fill(clientName);
  await page.locator('form#new-order-form button[type="submit"]').click();
  await page.waitForURL(/#\/order\//);
  const orderId = new URL(page.url()).hash.match(/#\/order\/([^/?]+)/)?.[1] || '';
  expect(orderId).toBeTruthy();

  await gotoHash(page, '/#/orders');
  await expect(orderCard(page, 'Toyota Camry')).toBeVisible();
  return orderId;
}

async function addPartToLocalOrder(page: Page, orderId: string, partId: string, partName: string) {
  await page.evaluate(async ({ orderId: targetOrderId, partId: targetPartId, partName: targetPartName }) => {
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

    const parts = Array.isArray(order.parts) ? order.parts : [];
    store.put({
      ...order,
      parts: [{
        id: targetPartId,
        orderId: targetOrderId,
        name: targetPartName,
        quantity: 1,
        comment: '',
        photoUrl: '',
        photos: [],
        variants: [],
        isFound: false,
        status: 'searching'
      }, ...parts],
      updatedAt: Date.now()
    });

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to add part'));
      tx.onabort = () => reject(tx.error ?? new Error('Add part transaction aborted'));
    });
    db.close();
  }, { orderId, partId, partName });
}

async function markOrderSearchDepositPaid(page: Page, clientName: string) {
  await page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dubai-spares-offline');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    });

    const tx = db.transaction('orders', 'readwrite');
    const store = tx.objectStore('orders');
    const orders = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>);
      request.onerror = () => reject(request.error ?? new Error('Failed to read orders'));
    });
    const order = orders.find((item) => item.clientName === name);
    if (!order) throw new Error(`Order for ${name} was not found`);

    store.put({
      ...order,
      searchDepositStatus: 'paid',
      searchDepositAmount: 50,
      searchDepositCurrency: 'AED',
      searchDepositAmountAed: 50,
      searchDepositPaidAt: Date.now(),
      paymentStatus: 'search_deposit_paid',
      status: order.status === 'lead' || order.status === 'waiting_deposit' ? 'in_progress' : order.status
    });

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to update order'));
      tx.onabort = () => reject(tx.error ?? new Error('Order update transaction aborted'));
    });
    db.close();
  }, clientName);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

test('new order form validates required fields', async ({ page }) => {
  await blockSupabase(page);
  await gotoHash(page, '/#/new');

  await page.locator('form#new-order-form button[type="submit"]').click();

  await expect(page.locator('form#new-order-form .text-rose-600')).toHaveCount(3);
  await expect(page).toHaveURL(/#\/new/);
});

test('public quote snapshot keeps proof pack attachments', async () => {
  const { normalizePublicQuoteSnapshotPayload } = await loadPublicQuoteSnapshotNormalizer();
  const normalized = normalizePublicQuoteSnapshotPayload({
    order: { brand: 'BMW', model: 'X5', year: '2003', vin: 'HHSHJSJHDBDBSH' },
    pricing: { currency: 'AED', rates: { AED: 1, USD: 0.27, RUB: 21, TJS: 2.6, KZT: 125, UZS: 3400 } },
    totals: { grand_total_aed: 1445.74 },
    proof_notes: [{
      id: 'proof-1',
      text: 'Attachment',
      attachments: [{
        id: 'attachment-1',
        kind: 'file',
        name: 'packing-proof.pdf',
        file_url: 'data:application/pdf;base64,JVBERi0xLjQ=',
        mime_type: 'application/pdf',
        size: 4096,
        created_at: 1
      }],
      photos: [],
      video_urls: [],
      audios: [],
      created_at: 1
    }]
  });

  expect(normalized?.proofNotes).toHaveLength(1);
  expect(normalized?.proofNotes[0].attachments).toHaveLength(1);
  expect(normalized?.proofNotes[0].attachments[0]).toMatchObject({
    kind: 'file',
    name: 'packing-proof.pdf',
    fileUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
    mimeType: 'application/pdf',
    size: 4096
  });
});

test('creates an order locally and filters it through search', async ({ page }) => {
  await createLocalOrder(page, 'QA Search User');

  await page.locator('header input').fill('no-such-order');
  await expect(page.locator('article').filter({ hasText: 'Toyota Camry' })).toHaveCount(0);

  await page.locator('header input').fill('toyota');
  await expect(orderCard(page, 'Toyota Camry')).toBeVisible();
});

test.describe('mobile orders workflows', () => {
  test.use({
    viewport: { width: 430, height: 920 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2
  });

  test('filter sheet actions stay clickable above the bottom navigation', async ({ page }) => {
    await blockSupabase(page);
    await gotoHash(page, '/#/orders');

    await page.getByRole('button', { name: /^Фильтр/ }).click();
    await expect(page.getByText('Фильтры и сортировка')).toBeVisible();

    await page.locator('.fixed.inset-0 select').first().selectOption('brand_asc');
    await page.getByRole('button', { name: 'Сброс' }).click();
    await page.getByRole('button', { name: 'Применить' }).click();

    await expect(page.getByText('Фильтры и сортировка')).toBeHidden();
  });
});

test('public request form shows required-field validation without submitting', async ({ page }) => {
  await blockSupabase(page);
  await page.goto('/request', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Введите данные автомобиля' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Далее/ })).toBeDisabled();

  await expect(page.getByText('Заполните обязательные поля:')).toBeVisible();
  await expect(page).toHaveURL(/\/request/);
});

test('current variants screen renders visible product images', async ({ page }) => {
  await gotoHash(page, '/#/variants');
  await expect(page.getByText(/вариант/).first()).toBeVisible();

  const visibleImages = page.locator('img:visible');
  await expect(visibleImages.first()).toBeVisible();

  const brokenImages = await visibleImages.evaluateAll((images) =>
    images
      .map((image) => image as HTMLImageElement)
      .filter((image) => !image.complete || image.naturalWidth === 0 || image.naturalHeight === 0)
      .map((image) => image.currentSrc || image.src)
  );

  expect(brokenImages).toEqual([]);
});

test('variants create form shows a vehicle dropdown from active orders', async ({ page }) => {
  await createLocalOrder(page, 'QA Vehicle Dropdown');

  await gotoHash(page, '/#/variants');
  await page.getByRole('button', { name: 'Новый вариант' }).click();

  const vehicleInput = page.getByPlaceholder('Данные автомобиля (марка/модель/VIN)');
  await vehicleInput.click();

  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  await expect(listbox).toContainText('Toyota Camry');

  const toyotaOption = page.getByRole('option').filter({ hasText: 'Toyota Camry' });
  await expect(toyotaOption).toBeVisible();
  await toyotaOption.click();

  await expect(vehicleInput).toHaveValue(/Toyota Camry 2020/);
});

test('part details allows adding and deleting sample photos', async ({ page }) => {
  const orderId = await createLocalOrder(page, 'QA Part Photos');
  const partId = 'qa-photo-part';
  await addPartToLocalOrder(page, orderId, partId, 'QA PHOTO PART');

  await page.goto(`/#/order/${orderId}/part/${partId}`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  await expect(page.getByRole('button', { name: 'Фото', exact: true })).toBeVisible();
  await expect(page.getByText('0 / 0')).toBeVisible();

  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: 'sample.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64'
    )
  });

  await expect(page.getByText('1 / 1')).toBeVisible({ timeout: 15_000 });
  const deletePhotoButton = page.getByRole('button', { name: 'Удалить фото 1' });
  await expect(deletePhotoButton).toBeVisible();
  await deletePhotoButton.click();

  await expect(page.getByText('0 / 0')).toBeVisible();
  await expect(deletePhotoButton).toHaveCount(0);
});

test('adding a standalone variant to an order does not leave a duplicate card', async ({ page }) => {
  const clientName = 'QA Variant Move';
  await createLocalOrder(page, clientName);
  await markOrderSearchDepositPaid(page, clientName);

  await gotoHash(page, '/#/variants');
  await page.getByRole('button', { name: 'Новый вариант' }).click();
  const createVariantModal = page.locator('.fixed.inset-0').filter({ hasText: 'Новый вариант' });
  await expect(createVariantModal).toBeVisible();
  await createVariantModal.getByPlaceholder('Поставщик', { exact: true }).fill('QA Move Supplier');
  await createVariantModal.getByPlaceholder('Деталь / название варианта').fill('QA MOVE BUMPER');
  await createVariantModal.getByPlaceholder('Цена покупки').fill('400');
  await createVariantModal.getByPlaceholder('Цена продажи').fill('500');
  await createVariantModal.getByRole('button', { name: 'Сохранить вариант' }).click();

  const createdCard = page.locator('article').filter({ hasText: 'QA MOVE BUMPER' });
  await expect(createdCard).toHaveCount(1);
  await expect(createdCard).toContainText('Без заказа');

  await createdCard.getByRole('button', { name: 'В заказ' }).click();
  const orderPicker = page.locator('.fixed.inset-0').filter({ hasText: 'Добавить в заказ' });
  await expect(orderPicker).toBeVisible();
  await orderPicker.getByRole('button').filter({ hasText: 'Toyota Camry' }).click();
  await page.waitForURL(/#\/order\//);

  await gotoHash(page, '/#/variants');
  const movedCard = page.locator('article').filter({ hasText: 'QA MOVE BUMPER' });
  await expect(movedCard).toHaveCount(1);
  await expect(movedCard).toContainText('Из заказа');
  await expect(movedCard).not.toContainText('Без заказа');

  await page.getByRole('button', { name: 'Без заказа' }).click();
  await expect(page.locator('article').filter({ hasText: 'QA MOVE BUMPER' })).toHaveCount(0);
});
