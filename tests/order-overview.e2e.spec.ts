import { expect, test, type Page } from '@playwright/test';
import { Priority, Source, type Order, type Part } from '../types';

const orderId = '73000000-0000-4000-8000-000000000001';
const partId = '74000000-0000-4000-8000-000000000001';
const offerId = '75000000-0000-4000-8000-000000000001';
const longModel = 'Range Rover Sport Autobiography Dynamic Black Edition';
test.use({ viewport: { width: 390, height: 844 } });
const primary = (page: Page, action: string) =>
  page.locator(`button[data-order-next-action="${action}"]`);

function part(overrides: Partial<Part> = {}): Part {
  return { id: partId, name: 'Передний бампер', isFound: false, variants: [], ...overrides };
}

function pricedPart(): Part {
  return part({
    isFound: true,
    status: 'found',
    bestOfferId: offerId,
    variants: [
      {
        id: offerId,
        priceAed: 700,
        purchasePriceAed: 500,
        salePriceAed: 700,
        shopName: 'Al Noor Parts',
        phone: '+971501234567',
        location: 'Sharjah',
        isBest: true,
        createdAt: Date.now(),
      },
    ],
  });
}

async function seed(page: Page, overrides: Partial<Order> = {}) {
  await page.goto('/#/orders');
  await expect(page.getByRole('heading', { name: 'Заказы', exact: true })).toBeVisible();
  const photo =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#e9edf3"/><path d="M80 330L165 220H595L730 330Z" fill="#34465d"/><circle cx="205" cy="340" r="45" fill="#172333"/><circle cx="615" cy="340" r="45" fill="#172333"/></svg>',
    );
  const order: Order = {
    id: orderId,
    brand: 'BMW',
    model: '3 Series',
    year: '2017',
    vin: 'WBA8E91090A123456',
    clientName: 'Ахмад',
    customerContact: '+971501234567',
    priority: Priority.MEDIUM,
    source: Source.WHATSAPP,
    status: 'active',
    parts: [],
    notes: [],
    carPhotoUrl: photo,
    carPhotos: [photo],
    markupPercent: 0,
    exchangeRate: 3.67,
    createdAt: Date.now() - 3600000,
    isArchived: false,
    isSold: false,
    paymentStatus: 'none',
    searchDepositStatus: 'pending',
    salesStatus: 'Inquiry',
    ...overrides,
  };
  await page.evaluate(async (row) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dubai-spares-offline');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('orders', 'readwrite');
      tx.objectStore('orders').put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, order);
  await page.goto(`/#/order/${orderId}`);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Обзор', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

async function stored(page: Page): Promise<Order> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dubai-spares-offline');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const order = await new Promise<Order>((resolve, reject) => {
      const request = db.transaction('orders', 'readonly').objectStore('orders').get(id);
      request.onsuccess = () => resolve(request.result as Order);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return order;
  }, orderId);
}

async function installWriteFailure(page: Page) {
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as Window & { overviewFail?: boolean }).overviewFail = true;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'orders' && (window as Window & { overviewFail?: boolean }).overviewFail)
        throw new DOMException('Full', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
}

async function failWrites(page: Page, fail: boolean) {
  await page.evaluate((value) => {
    (window as Window & { overviewFail?: boolean }).overviewFail = value;
  }, fail);
}

test('overview keeps long titles, all tabs and the primary action usable at every workspace width', async ({
  page,
}) => {
  await seed(page, {
    brand: 'Land Rover',
    model: longModel,
    clientName: 'Александр Константинопольский — отдел закупок автосервиса',
  });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const hero = page.locator('.order-overview-hero');
    const title = hero.getByRole('heading', { level: 1 });
    await title.scrollIntoViewIfNeeded();
    await expect(title).toContainText(longModel);
    const titleFits = await title.evaluate(
      (element) =>
        element.scrollWidth <= element.clientWidth + 1 &&
        element.scrollHeight <= element.clientHeight + 1,
    );
    expect(titleFits, `vehicle title clipped at ${width}px`).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const navigation = page.getByRole('navigation', { name: 'Разделы заказа', exact: true });
    for (const name of ['Обзор', 'Поиск', 'Материалы', 'Финансы', 'Заметки']) {
      const tab = navigation.getByRole('button', { name, exact: true });
      await expect(tab).toBeVisible();
      const box = (await tab.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
    const action = primary(page, 'add_parts');
    await expect(action).toBeVisible();
    expect(
      await action.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return (
          box.height >= 44 &&
          box.bottom <= innerHeight + 1 &&
          element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
        );
      }),
    ).toBe(true);
    const actionsTrigger = page.getByRole('button', { name: 'Действия', exact: true });
    await actionsTrigger.click();
    const menu = page.getByRole('dialog', { name: 'Действия с заказом', exact: true });
    await expect(menu.locator('.ui-modal-layer')).toBeFocused();
    await expect(menu.locator('button:focus')).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(menu.locator('button:visible').first()).toBeFocused();
    expect(
      await menu
        .locator('button:visible')
        .first()
        .evaluate((element) => element.matches(':focus-visible')),
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(actionsTrigger).toBeFocused();
  }
});

test('archived completed orders restore from the primary action without inventing payment', async ({
  page,
}) => {
  await seed(page, {
    status: 'archive',
    isArchived: true,
    isSold: true,
    salesStatus: 'Completed',
    parts: [part({ isFound: true })],
  });
  await expect(primary(page, 'restore')).toHaveText('Восстановить заказ');
  await expect(page.locator('.order-overview-hero')).toContainText('Завершён');
  await expect(page.locator('.order-overview-hero')).not.toContainText('Предоплата получена');
  await primary(page, 'restore').click();
  await expect.poll(async () => (await stored(page)).isArchived).toBe(false);
  const order = await stored(page);
  expect(order.isSold).toBe(false);
  expect(order.salesStatus).toBe('Inquiry');
  expect(order.paymentStatus).toBe('none');
  await page.reload();
  await expect(primary(page, 'restore')).toHaveCount(0);
  await expect(primary(page, 'deposit')).toBeVisible();
  await expect(page.locator('.order-overview-hero')).not.toContainText('Предоплата получена');
});

test('partial sourcing and missing prices stay factual and lead to the search queue', async ({
  page,
}) => {
  await seed(page, {
    searchDepositStatus: 'paid',
    paymentStatus: 'search_deposit_paid',
    parts: [
      part({ isFound: true }),
      part({ id: '74000000-0000-4000-8000-000000000002', name: 'Задний бампер' }),
      part({ id: '74000000-0000-4000-8000-000000000003', name: 'Крыло' }),
    ],
  });
  const summary = page.getByRole('region', { name: 'Сводка заказа', exact: true });
  const sourcing = summary.getByRole('button', {
    name: 'Подбор деталей: 1 из 3. Открыть поиск',
    exact: true,
  });
  await expect(sourcing.locator('strong')).toHaveText('1 из 3');
  await expect(sourcing).toContainText('Выбрано: 0');
  const quote = summary.getByRole('button', {
    name: 'Смета: Цены не указаны. Открыть финансы',
    exact: true,
  });
  await expect(quote.locator('strong')).toHaveText('Цены не указаны');
  await expect(quote).toContainText('С ценой: 0 из 3');
  await expect(summary.locator('.order-overview-profit')).toHaveCount(0);
  await expect(page.locator('.order-overview-hero')).toContainText('В поиске');
  await expect(page.locator('.order-overview-summary')).not.toContainText('Детали подобраны');
  await expect(primary(page, 'search')).toHaveText('Продолжить подбор');
  await primary(page, 'search').click();
  await expect(page.getByRole('button', { name: 'Поиск', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('article[role="button"]')).toHaveCount(3);
  await expect(page).toHaveURL(new RegExp(`#/order/${orderId}$`));
});

test('an empty request can add a part before deposit and then offers the deposit step', async ({
  page,
}) => {
  await seed(page);
  await expect(primary(page, 'add_parts')).toHaveText('Добавить детали');
  await primary(page, 'add_parts').click();
  const input = page.getByPlaceholder('Добавить деталь...', { exact: true });
  await expect(input).toBeVisible();
  await input.fill('Передний бампер M Sport');
  await page.getByRole('button', { name: 'Добавить деталь', exact: true }).click();
  await expect.poll(async () => (await stored(page)).parts.length).toBe(1);
  expect((await stored(page)).searchDepositStatus).not.toBe('paid');
  await expect(input).toHaveValue('');
  await page.getByRole('button', { name: 'Обзор', exact: true }).click();
  await expect(primary(page, 'deposit')).toHaveText('Подтвердить депозит');
  await page.reload();
  expect((await stored(page)).parts[0].name).toBe('Передний бампер M Sport');
  await expect(primary(page, 'deposit')).toBeVisible();
});

test('failed autosaves preserve client and VIN edits and retry merges every field', async ({
  page,
}) => {
  await seed(page);
  await installWriteFailure(page);
  await page.getByRole('button', { name: 'Редактировать клиента', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Имя клиента', exact: true });
  const phone = page.getByRole('textbox', { name: 'Телефон клиента', exact: true });
  await name.fill('Retry Buyer');
  await phone.fill('+971509876543');
  await phone.press('Tab');
  const clientRetry = page.getByRole('button', {
    name: 'Повторить сохранение клиента',
    exact: true,
  });
  await expect(clientRetry).toBeVisible();
  await expect(name).toHaveValue('Retry Buyer');
  await expect(phone).toHaveValue('+971509876543');
  expect((await stored(page)).clientName).toBe('Ахмад');
  expect((await stored(page)).customerContact).toBe('+971501234567');
  await failWrites(page, false);
  await clientRetry.click();
  await expect
    .poll(async () => {
      const order = await stored(page);
      return { name: order.clientName, phone: order.customerContact };
    })
    .toEqual({ name: 'Retry Buyer', phone: '+971509876543' });
  await expect(clientRetry).toHaveCount(0);

  await failWrites(page, true);
  await page.getByRole('button', { name: 'Редактировать авто', exact: true }).click();
  const vin = page.getByRole('textbox', { name: 'VIN автомобиля', exact: true });
  await vin.fill('WBA8E91090B654321');
  await vin.press('Tab');
  const vehicleRetry = page.getByRole('button', { name: 'Повторить сохранение авто', exact: true });
  await expect(vehicleRetry).toBeVisible();
  await expect(vin).toHaveValue('WBA8E91090B654321');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/order/${orderId}$`));
  await expect(vin).toHaveValue('WBA8E91090B654321');
  await failWrites(page, false);
  await vehicleRetry.click();
  await expect.poll(async () => (await stored(page)).vin).toBe('WBA8E91090B654321');
  await page.reload();
  const order = await stored(page);
  expect(order.clientName).toBe('Retry Buyer');
  expect(order.customerContact).toBe('+971509876543');
  expect(order.vin).toBe('WBA8E91090B654321');
});

test('deposit and prepayment failures retain the form and an edited deposit preserves full payment', async ({
  page,
}) => {
  await seed(page, { parts: [pricedPart()] });
  await installWriteFailure(page);
  const trigger = primary(page, 'deposit');
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Подтвердить депозит', exact: true });
  await expect(dialog.locator('.ui-modal-layer')).toBeFocused();
  await expect(dialog.locator('button:focus, input:focus')).toHaveCount(0);
  const amount = dialog.getByRole('textbox', { name: 'Сумма', exact: true });
  await amount.fill('0');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Депозит не сохранён');
  await expect(amount).toHaveValue('0');
  expect((await stored(page)).paymentStatus).toBe('none');
  expect((await stored(page)).notes).toHaveLength(0);
  await failWrites(page, false);
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await stored(page)).searchDepositStatus).toBe('paid');
  const deposited = await stored(page);
  expect(deposited.searchDepositAmount).toBe(0);
  expect(deposited.searchDepositAmountAed).toBe(0);
  expect(deposited.notes?.filter((note) => note.text.startsWith('Депозит'))).toHaveLength(1);

  await page.getByRole('button', { name: 'Финансы', exact: true }).click();
  await failWrites(page, true);
  const fullPayment = page.getByRole('button', { name: 'Полная предоплата', exact: true });
  await fullPayment.click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Предоплата не подтверждена' }),
  ).toBeVisible();
  expect((await stored(page)).paymentStatus).toBe('search_deposit_paid');
  await expect(
    page.getByText('Предоплата подтверждена. Можно готовить закупку.', { exact: true }),
  ).toHaveCount(0);
  await failWrites(page, false);
  await fullPayment.click();
  await expect.poll(async () => (await stored(page)).paymentStatus).toBe('full_prepayment_paid');
  const depositSection = page
    .locator('section')
    .filter({ has: page.getByRole('button', { name: 'Сохранить депозит', exact: true }) });
  await depositSection.getByRole('textbox', { name: 'Сумма', exact: true }).fill('1250');
  await depositSection.getByRole('button', { name: 'Сохранить депозит', exact: true }).click();
  await expect.poll(async () => (await stored(page)).searchDepositAmountAed).toBe(1250);
  expect((await stored(page)).paymentStatus).toBe('full_prepayment_paid');
  expect((await stored(page)).salesStatus).toBe('Paid');
  await page.reload();
  expect((await stored(page)).paymentStatus).toBe('full_prepayment_paid');
});

test('a failed quote save cannot share and cancelling native sharing cannot claim delivery', async ({
  page,
}) => {
  await seed(page, {
    parts: [pricedPart()],
    searchDepositStatus: 'paid',
    paymentStatus: 'search_deposit_paid',
  });
  const summary = page.getByRole('region', { name: 'Сводка заказа', exact: true });
  await expect(
    summary.getByRole('button', { name: 'Смета: 700 AED. Открыть финансы', exact: true }),
  ).toBeVisible();
  await expect(summary.locator('.order-overview-profit strong')).toHaveText('200 AED');
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  await page.evaluate(() => {
    (window as Window & { quoteShareCalls?: number }).quoteShareCalls = 0;
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        const state = window as Window & { quoteShareCalls?: number };
        state.quoteShareCalls = (state.quoteShareCalls || 0) + 1;
        throw new DOMException('Cancelled', 'AbortError');
      },
    });
  });
  await installWriteFailure(page);
  await primary(page, 'quote').click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Не удалось сохранить' }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as Window & { quoteShareCalls?: number }).quoteShareCalls),
  ).toBe(0);
  expect(downloads).toEqual([]);
  const failed = await stored(page);
  expect(failed.salesStatus).toBe('Inquiry');
  expect(failed.publicQuoteToken).toBeUndefined();
  await expect(primary(page, 'quote')).toBeEnabled();
  await failWrites(page, false);
  await primary(page, 'quote').click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { quoteShareCalls?: number }).quoteShareCalls),
    )
    .toBe(1);
  await expect(page.getByText('Смета создана. Отправка отменена.', { exact: true })).toBeVisible();
  await expect(page.getByText('Смета готова к отправке', { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await stored(page)).publicQuoteToken).toBeTruthy();
  expect((await stored(page)).salesStatus).toBe('Inquiry');
  expect(downloads).toEqual([]);
});

test('missing contact, delivery and VIN actions focus the right fields and preserve changes through delivery failure', async ({
  page,
}) => {
  await seed(page, {
    clientName: '',
    customerContact: '',
    vin: '',
    logistics: { deliveryType: 'export' },
  });
  const missing = page.locator('.order-overview-missing');
  await missing.locator('summary').click();
  await missing.getByRole('button', { name: 'Указать контакт клиента', exact: true }).click();
  const phone = page.getByRole('textbox', { name: 'Телефон клиента', exact: true });
  await expect(phone).toBeFocused();
  await phone.fill('+971509876543');
  await phone.press('Tab');
  await expect.poll(async () => (await stored(page)).customerContact).toBe('+971509876543');
  await expect(
    missing.getByRole('button', { name: 'Указать контакт клиента', exact: true }),
  ).toHaveCount(0);

  await missing.getByRole('button', { name: 'Указать доставку', exact: true }).click();
  const delivery = page.getByRole('dialog', { name: 'Место доставки', exact: true });
  await expect(delivery).toBeVisible();
  const country = delivery.getByRole('textbox', { name: 'Страна доставки', exact: true });
  await country.fill('Таджикистан');
  await installWriteFailure(page);
  await delivery.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(delivery.getByRole('alert')).toBeVisible();
  await expect(country).toHaveValue('Таджикистан');
  expect((await stored(page)).logistics?.cargoCountry).toBeUndefined();
  expect((await stored(page)).customerContact).toBe('+971509876543');
  await failWrites(page, false);
  await delivery.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(delivery).toHaveCount(0);
  await expect.poll(async () => (await stored(page)).logistics?.cargoCountry).toBe('Таджикистан');
  expect((await stored(page)).logistics?.deliveryType).toBe('export');
  await expect(missing.getByRole('button', { name: 'Указать доставку', exact: true })).toHaveCount(
    0,
  );

  await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить VIN', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Обзор', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const vin = page.getByRole('textbox', { name: 'VIN автомобиля', exact: true });
  await expect(vin).toBeFocused();
  await vin.fill('WBA8E91090B654321');
  await vin.press('Tab');
  await expect.poll(async () => (await stored(page)).vin).toBe('WBA8E91090B654321');
  await page.reload();
  const order = await stored(page);
  expect(order.customerContact).toBe('+971509876543');
  expect(order.logistics?.cargoCountry).toBe('Таджикистан');
  expect(order.logistics?.deliveryType).toBe('export');
  expect(order.vin).toBe('WBA8E91090B654321');
  await expect(page.locator('.order-overview-missing')).toHaveCount(0);
});

test('pending part writes block conflicting actions and subsequent archiving preserves the part and order details', async ({
  page,
}) => {
  await seed(page, {
    parts: [pricedPart()],
    paymentStatus: 'search_deposit_paid',
    searchDepositStatus: 'paid',
    logistics: { deliveryType: 'export', cargoCountry: 'Таджикистан', deliveryAed: 80 },
  });
  const addedName = 'Задний бампер — проверка сохранения';
  const menu = page.getByRole('dialog', { name: 'Действия с заказом', exact: true });
  await page.getByRole('button', { name: 'Действия', exact: true }).click();
  await expect(
    menu.getByRole('button', { name: 'Создать и поделиться сметой', exact: true }),
  ).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Поиск', exact: true }).click();

  await page.evaluate((partName) => {
    type PendingWrite = { held: boolean; release?: () => void };
    const state: PendingWrite = { held: false };
    (window as Window & { overviewPendingWrite?: PendingWrite }).overviewPendingWrite = state;
    const heldTransactions = new WeakSet<IDBTransaction>();
    const originalPut = IDBObjectStore.prototype.put;
    let holdNextPart = true;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      const value = args[0] as { parts?: Array<{ name?: string }> };
      if (
        this.name === 'orders' &&
        holdNextPart &&
        value.parts?.some((item) => item.name === partName)
      ) {
        heldTransactions.add(this.transaction);
        holdNextPart = false;
      }
      return originalPut.apply(this, args);
    };
    const completion = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')!;
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
      ...completion,
      set(this: IDBTransaction, listener: IDBTransaction['oncomplete']) {
        const transaction = this;
        completion.set!.call(this, function (event: Event) {
          if (!heldTransactions.has(transaction)) {
            listener?.call(transaction, event);
            return;
          }
          heldTransactions.delete(transaction);
          const heldAt = performance.now();
          state.held = true;
          // Delay acknowledgement after a real commit, never the request callbacks that
          // IndexedDB needs to keep later requests in this transaction active.
          state.release = () => {
            window.setTimeout(
              () => listener?.call(transaction, event),
              Math.max(0, 300 - (performance.now() - heldAt)),
            );
          };
        });
      },
    });
  }, addedName);

  const input = page.getByPlaceholder('Добавить деталь...', { exact: true });
  await input.fill(addedName);
  const add = page.getByRole('button', { name: 'Добавить деталь', exact: true });
  await add.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { overviewPendingWrite?: { held: boolean } }).overviewPendingWrite
            ?.held,
      ),
    )
    .toBe(true);
  await expect(add).toBeDisabled();
  await expect(input).toHaveValue(addedName);
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/order/${orderId}$`));
  await page.getByRole('button', { name: 'Действия', exact: true }).click();
  await expect(menu.getByRole('button', { name: 'В архив', exact: true })).toBeDisabled();
  await expect(
    menu.getByRole('button', { name: 'Создать и поделиться сметой', exact: true }),
  ).toBeDisabled();

  await page.evaluate(() => {
    (
      window as Window & { overviewPendingWrite?: { release?: () => void } }
    ).overviewPendingWrite?.release?.();
  });
  await expect(input).toHaveValue('');
  await expect(menu.getByRole('button', { name: 'В архив', exact: true })).toBeEnabled();
  await menu.getByRole('button', { name: 'В архив', exact: true }).click();
  await expect.poll(async () => (await stored(page)).isArchived).toBe(true);
  await page.reload();
  const order = await stored(page);
  expect(order.parts).toHaveLength(2);
  expect(order.parts.filter((item) => item.name === addedName)).toHaveLength(1);
  expect(order.parts.find((item) => item.id === partId)?.bestOfferId).toBe(offerId);
  expect(order.clientName).toBe('Ахмад');
  expect(order.customerContact).toBe('+971501234567');
  expect(order.vin).toBe('WBA8E91090A123456');
  expect(order.paymentStatus).toBe('search_deposit_paid');
  expect(order.logistics).toMatchObject({
    deliveryType: 'export',
    cargoCountry: 'Таджикистан',
    deliveryAed: 80,
  });
  await expect(primary(page, 'restore')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Подбор деталей: 1 из 2. Открыть поиск', exact: true }),
  ).toBeVisible();
});
