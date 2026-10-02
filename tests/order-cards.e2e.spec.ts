import { expect, test, type Locator, type Page } from '@playwright/test';
import { Priority, Source, type Order, type Part } from '../types';

const firstId = '71000000-0000-4000-8000-000000000001';
const secondId = '71000000-0000-4000-8000-000000000002';
const leadId = '71000000-0000-4000-8000-000000000003';
const completedId = '71000000-0000-4000-8000-000000000004';
const pendingId = '71000000-0000-4000-8000-000000000005';
const longModel = 'Range Rover Sport Autobiography Dynamic Black Edition';
const longClient = 'Александр Константинопольский — отдел закупок автосервиса';
const card = (page: Page, id: string) => page.locator(`article[data-order-id="${id}"]`);
const actionSheet = (page: Page) =>
  page.getByRole('dialog', { name: 'Действия с заказом', exact: true });

function makePart(id: string, overrides: Partial<Part> = {}): Part {
  return { id, name: `Деталь ${id}`, isFound: false, variants: [], ...overrides };
}

function makeOrder(id: string, overrides: Partial<Order> = {}): Order {
  return {
    id,
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
    markupPercent: 15,
    exchangeRate: 3.67,
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now() - 3600000,
    isArchived: false,
    isSold: false,
    paymentStatus: 'none',
    searchDepositStatus: 'not_required',
    ...overrides,
  };
}

async function seed(page: Page, orders: Order[]) {
  await page.goto('/#/orders');
  await expect(page.getByRole('heading', { name: 'Заказы', exact: true })).toBeVisible();
  await page.evaluate(async (rows) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dubai-spares-offline');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('orders', 'readwrite');
      const store = tx.objectStore('orders');
      store.clear();
      rows.forEach((order) => store.put(order));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, orders);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Заказы', exact: true })).toBeVisible();
}

async function readOrder(page: Page, id: string): Promise<Order> {
  return page.evaluate(async (orderId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dubai-spares-offline');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const order = await new Promise<Order>((resolve, reject) => {
      const request = db.transaction('orders', 'readonly').objectStore('orders').get(orderId);
      request.onsuccess = () => resolve(request.result as Order);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return order;
  }, id);
}

async function openActions(page: Page, id: string) {
  await card(page, id).locator('.order-card-menu-trigger').click();
  await expect(actionSheet(page)).toBeVisible();
}

async function closeActions(page: Page) {
  if (await actionSheet(page).count()) await page.keyboard.press('Escape');
  await expect(actionSheet(page)).toHaveCount(0);
}

test('long vehicle and client names retain their own space at every workspace width', async ({
  page,
}) => {
  await seed(page, [
    makeOrder(firstId, { brand: 'Land Rover', model: longModel, clientName: longClient }),
  ]);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const order = card(page, firstId);
    await order.scrollIntoViewIfNeeded();
    const title = order.locator('.order-card-title');
    const client = order.locator('.order-card-client');
    const menu = order.locator('.order-card-menu-trigger');
    await expect(title).toContainText(`Land Rover ${longModel}`);
    await expect(client).toContainText(longClient);
    const geometry = await order.evaluate((article) => {
      const bounds = (selector: string) => {
        const element = article.querySelector<HTMLElement>(selector)!;
        const box = element.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        };
      };
      return {
        title: bounds('.order-card-title'),
        client: bounds('.order-card-client'),
        menu: bounds('.order-card-menu-trigger'),
        article: article.getBoundingClientRect().toJSON(),
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
      };
    });
    expect(geometry.documentWidth, `page overflow at ${width}px`).toBeLessThanOrEqual(width);
    expect(geometry.title.scrollWidth).toBeLessThanOrEqual(geometry.title.clientWidth + 1);
    expect(geometry.title.scrollHeight).toBeLessThanOrEqual(geometry.title.clientHeight + 1);
    expect(geometry.client.scrollWidth).toBeLessThanOrEqual(geometry.client.clientWidth + 1);
    expect(geometry.menu.width).toBeGreaterThanOrEqual(44);
    expect(geometry.menu.height).toBeGreaterThanOrEqual(44);
    expect(geometry.title.left).toBeGreaterThanOrEqual(geometry.article.left);
    expect(geometry.title.right).toBeLessThanOrEqual(geometry.article.right);
    const overlaps = (a: typeof geometry.title, b: typeof geometry.menu) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    expect(overlaps(geometry.title, geometry.menu), `title/action overlap at ${width}px`).toBe(
      false,
    );
    expect(overlaps(geometry.client, geometry.menu), `client/action overlap at ${width}px`).toBe(
      false,
    );
    await expect(menu).toBeVisible();
  }
});

test('cards distinguish partial search, completed selection, empty requests and paid interest', async ({
  page,
}) => {
  await seed(page, [
    makeOrder(firstId, {
      parts: [
        makePart('found', { isFound: true }),
        makePart('offer', {
          variants: [
            {
              id: '72000000-0000-4000-8000-000000000001',
              priceAed: 500,
              shopName: 'Al Noor Parts',
              phone: '',
              location: '',
              createdAt: Date.now(),
            },
          ],
        }),
        makePart('searching'),
      ],
    }),
    makeOrder(secondId, { model: 'X5' }),
    makeOrder(completedId, {
      brand: 'Toyota',
      model: 'Camry',
      parts: [makePart('complete', { isFound: true })],
    }),
    makeOrder(leadId, {
      brand: 'Mercedes-Benz',
      model: 'E-Class',
      status: 'interest',
      paymentStatus: 'search_deposit_paid',
      searchDepositStatus: 'paid',
    }),
    makeOrder(pendingId, {
      brand: 'Audi',
      model: 'A6',
      searchDepositStatus: 'pending',
      parts: [makePart('pending-found', { isFound: true })],
    }),
  ]);
  await expect(card(page, firstId)).toContainText('В поиске');
  await expect(card(page, firstId).locator('.order-card-progress')).toContainText('2 из 3');
  await expect(card(page, firstId)).not.toContainText('Детали подобраны');
  await expect(card(page, completedId)).toContainText('Детали подобраны');
  await expect(card(page, completedId).locator('.order-card-progress')).toContainText('1 из 1');
  await expect(card(page, secondId)).toContainText('Детали не добавлены');
  await expect(card(page, secondId)).not.toContainText(/0\s*(?:\/|из)\s*0|100%/);
  await expect(card(page, pendingId)).toContainText('Ожидаем депозит');
  await expect(card(page, pendingId)).not.toContainText('Детали подобраны');
  await expect(card(page, pendingId)).not.toContainText('Депозит внесён');
  await expect(card(page, pendingId).locator('.order-card-progress')).toContainText('1 из 1');
  await expect(card(page, firstId).locator('.order-card-client')).toContainText('Ахмад');
  await expect(card(page, firstId)).toContainText('WBA8E91090A123456');
  await page.getByRole('button', { name: /^Интерес/ }).click();
  await expect(card(page, leadId)).toContainText('Интерес');
  await expect(card(page, leadId)).toContainText('Депозит внесён');
  await expect(card(page, leadId)).not.toContainText('Оплаченный клиент');
});

test('keyboard opens the order while copy and pin actions keep the list and persist pinning', async ({
  page,
}) => {
  await seed(page, [
    makeOrder(firstId),
    makeOrder(secondId, { model: 'X5', createdAt: Date.now() }),
  ]);
  const title = card(page, firstId).getByRole('button', {
    name: 'Открыть заказ BMW 3 Series',
    exact: true,
  });
  await title.focus();
  await title.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/order/${firstId}$`));
  await page.goto('/#/orders');
  await expect(card(page, firstId)).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as Window & { copiedVehicle?: string }).copiedVehicle = text;
        },
      },
    });
  });
  await openActions(page, firstId);
  await actionSheet(page)
    .getByRole('button', { name: 'Скопировать марку, модель и год', exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as Window & { copiedVehicle?: string }).copiedVehicle))
    .toBe('BMW 3 Series 2017');
  await closeActions(page);
  await expect(page).toHaveURL(/#\/orders$/);
  await openActions(page, firstId);
  await actionSheet(page).getByRole('button', { name: 'Закрепить заказ', exact: true }).click();
  await expect.poll(async () => (await readOrder(page, firstId)).isPinned).toBe(true);
  await closeActions(page);
  await expect(page.locator('article[data-order-id]').first()).toHaveAttribute(
    'data-order-id',
    firstId,
  );
  await expect(page).toHaveURL(/#\/orders$/);
  await page.reload();
  await expect(page.locator('article[data-order-id]').first()).toHaveAttribute(
    'data-order-id',
    firstId,
  );
  await openActions(page, firstId);
  await expect(
    actionSheet(page).getByRole('button', { name: 'Открепить заказ', exact: true }),
  ).toBeVisible();
});

test('failed pinning preserves the existing order and offers a successful retry', async ({
  page,
}) => {
  await seed(page, [makeOrder(firstId)]);
  await openActions(page, firstId);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as Window & { orderCardFail?: boolean }).orderCardFail = true;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'orders' && (window as Window & { orderCardFail?: boolean }).orderCardFail)
        throw new DOMException('Full', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await actionSheet(page).getByRole('button', { name: 'Закрепить заказ', exact: true }).click();
  await expect(actionSheet(page).getByRole('alert')).toBeVisible();
  expect((await readOrder(page, firstId)).isPinned).not.toBe(true);
  await expect(
    actionSheet(page).getByRole('button', { name: 'Закрепить заказ', exact: true }),
  ).toBeEnabled();
  await expect(page).toHaveURL(/#\/orders$/);
  await page.evaluate(() => {
    (window as Window & { orderCardFail?: boolean }).orderCardFail = false;
  });
  await actionSheet(page).getByRole('button', { name: 'Закрепить заказ', exact: true }).click();
  await expect.poll(async () => (await readOrder(page, firstId)).isPinned).toBe(true);
  await expect(actionSheet(page)).toHaveCount(0);
  await page.reload();
  await openActions(page, firstId);
  await expect(
    actionSheet(page).getByRole('button', { name: 'Открепить заказ', exact: true }),
  ).toBeVisible();
});

test('selection archives without navigation, archived leads stay visible and completed orders restore', async ({
  page,
}) => {
  await seed(page, [
    makeOrder(firstId),
    makeOrder(secondId, { model: 'X5' }),
    makeOrder(leadId, {
      brand: 'Toyota',
      model: 'Camry',
      status: 'lead',
      isLead: true,
      leadUnread: true,
      customerStatus: 'LEAD',
    }),
    makeOrder(completedId, {
      brand: 'Mercedes-Benz',
      model: 'E-Class',
      status: 'archive',
      isArchived: true,
      isSold: true,
      salesStatus: 'Completed',
    }),
  ]);
  await page.getByRole('button', { name: 'Выбрать несколько заказов', exact: true }).click();
  await card(page, firstId).locator('.order-card-client').click();
  await expect(
    card(page, firstId).getByRole('button', { name: 'Снять выбор заказа', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/#\/orders$/);
  await page.getByRole('button', { name: 'В архив', exact: true }).click();
  await expect.poll(async () => (await readOrder(page, firstId)).isArchived).toBe(true);
  await expect(card(page, firstId)).toHaveCount(0);
  await expect(card(page, secondId)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /^Интерес/ }).click();
  await openActions(page, leadId);
  await actionSheet(page).getByRole('button', { name: 'В архив', exact: true }).click();
  await expect.poll(async () => (await readOrder(page, leadId)).isArchived).toBe(true);
  await closeActions(page);
  await page.getByRole('button', { name: /^Архив/ }).click();
  await expect(card(page, firstId)).toBeVisible();
  await expect(card(page, leadId)).toBeVisible();
  await expect(card(page, completedId)).toBeVisible();
  await expect(card(page, completedId)).not.toContainText('Предоплата получена');
  await openActions(page, completedId);
  await actionSheet(page).getByRole('button', { name: 'Восстановить заказ', exact: true }).click();
  await expect.poll(async () => (await readOrder(page, completedId)).salesStatus).toBe('Inquiry');
  await closeActions(page);
  const restored = await readOrder(page, completedId);
  expect(restored.isArchived).toBe(false);
  expect(restored.isSold).toBe(false);
  await page.reload();
  await page.getByRole('button', { name: /^Актив/ }).click();
  await expect(card(page, completedId)).toBeVisible();
  await expect(card(page, completedId)).not.toContainText('Предоплата получена');
});

test('partial bulk archive failure retains selection, blocks changes while saving and retries only the failed order', async ({
  page,
}) => {
  await seed(page, [makeOrder(firstId), makeOrder(secondId, { model: 'X5' })]);
  await page.getByRole('button', { name: 'Выбрать несколько заказов', exact: true }).click();
  await card(page, firstId).locator('.order-card-client').click();
  await card(page, secondId).locator('.order-card-client').click();
  await expect(page.getByText('2 выбрано', { exact: true })).toBeVisible();

  await page.evaluate(
    ({ successId, failureId }) => {
      type BulkState = {
        held: boolean;
        fail: boolean;
        release?: () => void;
        toasts: Array<{ message: string; tone: string }>;
      };
      const state: BulkState = { held: false, fail: true, toasts: [] };
      (window as Window & { orderBulkTest?: BulkState }).orderBulkTest = state;
      window.addEventListener('app-toast', (event) => {
        const detail = (event as CustomEvent<{ message: string; tone: string }>).detail;
        state.toasts.push({ message: detail.message, tone: detail.tone });
      });

      const heldTransactions = new WeakSet<IDBTransaction>();
      let gateNextSuccess = true;
      const originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
        const value = args[0] as { id?: string; isArchived?: boolean };
        if (this.name === 'orders' && value.isArchived) {
          if (value.id === failureId && state.fail)
            throw new DOMException('Full', 'QuotaExceededError');
          if (value.id === successId && gateNextSuccess) {
            heldTransactions.add(this.transaction);
            gateNextSuccess = false;
          }
        }
        return originalPut.apply(this, args);
      };

      // Delay the completion notification after a real commit, leaving IndexedDB request
      // sequencing intact while the application is still awaiting its storage operation.
      const completion = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')!;
      Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
        ...completion,
        set(this: IDBTransaction, listener: IDBTransaction['oncomplete']) {
          const transaction = this;
          completion.set!.call(this, function (event: Event) {
            if (heldTransactions.has(transaction)) {
              heldTransactions.delete(transaction);
              state.held = true;
              state.release = () => listener?.call(transaction, event);
            } else listener?.call(transaction, event);
          });
        },
      });
    },
    { successId: firstId, failureId: secondId },
  );

  const archive = page.getByRole('button', { name: 'В архив', exact: true });
  await archive.click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { orderBulkTest?: { held: boolean } }).orderBulkTest?.held,
      ),
    )
    .toBe(true);
  await expect(archive).toBeDisabled();
  await expect(archive).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('button', { name: 'Удалить', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Закончить выбор заказов', exact: true }),
  ).toBeDisabled();
  for (const label of ['Все 2', 'Снять', 'Готово'])
    await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled();
  for (const id of [firstId, secondId])
    await expect(
      card(page, id).getByRole('button', { name: 'Снять выбор заказа', exact: true }),
    ).toBeDisabled();

  await page.evaluate(() => {
    (window as Window & { orderBulkTest?: { release?: () => void } }).orderBulkTest?.release?.();
  });
  await expect(page.getByText(/Не удалось сохранить.*остаются выбранными/)).toBeVisible();
  await expect.poll(async () => (await readOrder(page, firstId)).isArchived).toBe(true);
  expect((await readOrder(page, secondId)).isArchived).toBe(false);
  await expect(card(page, firstId)).toHaveCount(0);
  await expect(card(page, secondId)).toBeVisible();
  await expect(page.getByText('1 выбрано', { exact: true })).toBeVisible();
  await expect(
    card(page, secondId).getByRole('button', { name: 'Снять выбор заказа', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: 'Закончить выбор заказов', exact: true }),
  ).toBeEnabled();
  await expect(archive).toBeEnabled();
  const toasts = await page.evaluate(
    () =>
      (
        window as Window & {
          orderBulkTest?: { toasts: Array<{ message: string; tone: string }> };
        }
      ).orderBulkTest!.toasts,
  );
  expect(
    toasts.some((toast) => toast.tone === 'error' && /остаются выбранными/.test(toast.message)),
  ).toBe(true);
  expect(
    toasts.some((toast) => toast.tone === 'success' && /В архив отправлено/.test(toast.message)),
  ).toBe(false);

  await page.evaluate(() => {
    (window as Window & { orderBulkTest?: { fail: boolean } }).orderBulkTest!.fail = false;
  });
  await archive.click();
  await expect.poll(async () => (await readOrder(page, secondId)).isArchived).toBe(true);
  await expect(
    page.getByRole('button', { name: 'Выбрать несколько заказов', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Закончить выбор заказов', exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: /^Архив/ }).click();
  await expect(card(page, firstId)).toBeVisible();
  await expect(card(page, secondId)).toBeVisible();
});

async function hold(page: Page, surface: Locator) {
  await surface.scrollIntoViewIfNeeded();
  const box = (await surface.boundingBox())!;
  await page.mouse.move(box.x + Math.min(20, box.width / 2), box.y + box.height / 2);
  await page.mouse.down();
  await expect(actionSheet(page)).toBeVisible();
  await page.mouse.up();
}

test('touch scrolling cancels a hold while stationary holding and right click open actions', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(
    page,
    Array.from({ length: 10 }, (_, index) =>
      makeOrder(`71000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, {
        model: `3 Series ${index + 1}`,
        createdAt: Date.now() - index * 1000,
      }),
    ),
  );
  const surface = card(page, firstId).locator('.order-card-client');
  await surface.scrollIntoViewIfNeeded();
  const box = (await surface.boundingBox())!;
  const x = box.x + 20;
  const y = box.y + box.height / 2;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const before = await page.evaluate(() => scrollY);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: y - 85 }],
  });
  await page.waitForTimeout(750);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(actionSheet(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#\/orders$/);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(before);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await hold(page, surface);
  await expect(actionSheet(page).locator('button:focus')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Подтвердите действие', exact: true })).toHaveCount(
    0,
  );
  await closeActions(page);
  await surface.click({ button: 'right' });
  await expect(actionSheet(page)).toBeVisible();
  await expect(page).toHaveURL(/#\/orders$/);
});
