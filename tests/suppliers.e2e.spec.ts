import { expect, test, type Locator, type Page } from '@playwright/test';
import { Priority, Source, type Order, type Supplier } from '../types';

const firstId = '81000000-0000-4000-8000-000000000001';
const secondId = '81000000-0000-4000-8000-000000000002';
const thirdId = '81000000-0000-4000-8000-000000000003';
const longName = 'Al Noor BMW & McLaren Automotive Spare Parts Trading Company UAE';
const storageKey = 'dubai_spares_suppliers';
const photo =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect width="80" height="80" fill="%232f56df"/%3E%3C/svg%3E';

const card = (page: Page, id: string) => page.locator(`article[data-supplier-id="${id}"]`);
const cards = (page: Page) => page.locator('article[data-supplier-id]');
const menu = (page: Page) =>
  page.getByRole('dialog', { name: 'Действия с поставщиком', exact: true });
const form = (page: Page) => page.getByRole('dialog', { name: 'Поставщик', exact: true });

function supplier(id: string, overrides: Partial<Supplier> = {}): Supplier {
  return {
    id,
    name: 'Mahmud BMW Parts',
    phone: '+971501234567',
    whatsapp: '+971509876543',
    location: '25.32265, 55.37892',
    zone: 'Sajaa',
    type: 'scrapyard',
    types: ['scrapyard'],
    brands: ['BMW'],
    mainBrands: ['BMW'],
    models: ['3 Series'],
    years: [2017],
    mainPartCategories: ['Кузовные детали'],
    createdAt: Date.now() - 86_400_000,
    updatedAt: Date.now() - 3_600_000,
    ...overrides,
  };
}

async function seed(page: Page, suppliers: Supplier[]) {
  await page.goto('/#/database');
  await expect(page.getByRole('heading', { name: 'Поставщики', exact: true })).toBeVisible();
  await page.evaluate(({ key, rows }) => localStorage.setItem(key, JSON.stringify(rows)), {
    key: storageKey,
    rows: suppliers,
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Поставщики', exact: true })).toBeVisible();
  await expect(cards(page)).toHaveCount(suppliers.length);
}

async function stored(page: Page): Promise<Supplier[]> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), storageKey);
}

async function ids(page: Page): Promise<string[]> {
  return cards(page).evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-supplier-id')!),
  );
}

async function openMenu(page: Page, id: string) {
  await card(page, id).getByRole('button', { name: 'Действия поставщика', exact: true }).click();
  await expect(menu(page)).toBeVisible();
}

async function installWriteFailure(page: Page) {
  await page.evaluate((key) => {
    const state = window as Window & {
      supplierWriteFails?: boolean;
      failedSupplierPayloads?: Supplier[][];
    };
    state.supplierWriteFails = true;
    state.failedSupplierPayloads = [];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (targetKey: string, value: string) {
      if (targetKey === key && state.supplierWriteFails) {
        state.failedSupplierPayloads!.push(JSON.parse(value));
        throw new DOMException('QA supplier quota', 'QuotaExceededError');
      }
      return original.call(this, targetKey, value);
    };
  }, storageKey);
}

async function failWrites(page: Page, value: boolean) {
  await page.evaluate((failure) => {
    (window as Window & { supplierWriteFails?: boolean }).supplierWriteFails = failure;
  }, value);
}

test('supplier names and contact actions retain space from 320 to 1440 pixels', async ({
  page,
}) => {
  await seed(page, [supplier(firstId, { name: longName })]);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const item = card(page, firstId);
    await item.scrollIntoViewIfNeeded();
    const title = item.getByRole('button', {
      name: `Открыть поставщика: ${longName}`,
      exact: true,
    });
    await expect(title).toHaveText(longName);
    const geometry = await title.evaluate((element) => {
      const article = element.closest('article')!;
      return {
        title: element.getBoundingClientRect().toJSON(),
        article: article.getBoundingClientRect().toJSON(),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        documentWidth: document.documentElement.scrollWidth,
        actions: Array.from(article.querySelectorAll('button,a')).map((action) => ({
          label: action.getAttribute('aria-label') || action.textContent?.trim(),
          box: action.getBoundingClientRect().toJSON(),
        })),
      };
    });
    expect(geometry.documentWidth, `page width at ${width}`).toBeLessThanOrEqual(width);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    expect(geometry.scrollHeight, `clipped supplier name at ${width}`).toBeLessThanOrEqual(
      geometry.clientHeight + 1,
    );
    expect(geometry.title.left).toBeGreaterThanOrEqual(geometry.article.left);
    expect(geometry.title.right).toBeLessThanOrEqual(geometry.article.right);
    for (const action of geometry.actions) {
      if (action.box.width === 0 || action.box.height === 0) continue;
      expect(action.box.width, `${action.label} width at ${width}`).toBeGreaterThanOrEqual(44);
      expect(action.box.height, `${action.label} height at ${width}`).toBeGreaterThanOrEqual(44);
      expect(action.box.left).toBeGreaterThanOrEqual(geometry.article.left);
      expect(action.box.right).toBeLessThanOrEqual(geometry.article.right);
    }
    await expect(item).not.toContainText(/17[.,]8\s*(?:км|km)|ОБЫЧН\.|ДОВЕРИЕ\s+3\/5/);
  }
});

test('search, favorites, committed filters and sorting agree and reset empty results', async ({
  page,
}) => {
  await seed(page, [
    supplier(firstId, { isPinned: true, whatsappFast: true }),
    supplier(secondId, {
      name: 'Alpha Toyota Parts',
      phone: '+971504445555',
      whatsapp: '',
      location: 'Al Quoz Industrial Area',
      zone: 'Al Quoz',
      brands: ['Toyota'],
      mainBrands: ['Toyota'],
      models: ['Camry'],
      years: [2020],
      isFavorite: true,
      mainPartCategories: ['ДВС / Двигатели'],
      updatedAt: Date.now() - 1_800_000,
    }),
    supplier(thirdId, {
      name: 'Zeta Mercedes Parts',
      phone: '+971506667777',
      whatsapp: '',
      brands: ['Mercedes-Benz'],
      mainBrands: ['Mercedes-Benz'],
      models: ['E-Class'],
      years: [2019],
      zone: 'Ras Al Khor',
      whatsappFast: true,
      updatedAt: Date.now() - 1000,
    }),
  ]);
  const search = page.getByRole('searchbox', { name: 'Поиск поставщиков', exact: true });
  await search.fill('Al Quoz');
  await expect.poll(() => ids(page)).toEqual([secondId]);
  await search.fill('971 50 123 4567');
  await expect.poll(() => ids(page)).toEqual([firstId]);
  await page.getByRole('button', { name: 'Очистить поиск', exact: true }).click();
  await expect(search).toBeFocused();
  await page.getByRole('button', { name: 'Избранные поставщики', exact: true }).click();
  await expect.poll(() => ids(page)).toEqual([secondId]);
  await page.getByRole('button', { name: 'Все поставщики', exact: true }).click();
  await expect(cards(page)).toHaveCount(3);

  await page.getByRole('button', { name: 'Фильтры поставщиков', exact: true }).click();
  const filters = page.getByRole('dialog', { name: 'Фильтры поставщиков', exact: true });
  await expect(filters.locator('.ui-modal-layer')).toBeFocused();
  await filters.getByRole('combobox', { name: 'Марка', exact: true }).selectOption('BMW');
  await filters.getByRole('checkbox', { name: 'Быстрый ответ в WhatsApp', exact: true }).check();
  await filters.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(cards(page)).toHaveCount(3);
  await page.getByRole('button', { name: 'Фильтры поставщиков', exact: true }).click();
  await expect(filters.getByRole('combobox', { name: 'Марка', exact: true })).toHaveValue('all');
  await expect(
    filters.getByRole('checkbox', { name: 'Быстрый ответ в WhatsApp', exact: true }),
  ).not.toBeChecked();
  await filters.getByRole('checkbox', { name: 'Быстрый ответ в WhatsApp', exact: true }).check();
  await filters.getByRole('button', { name: 'Показать поставщиков', exact: true }).click();
  await expect.poll(async () => (await ids(page)).sort()).toEqual([firstId, thirdId]);
  await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();

  for (const item of [
    { label: 'Марка', value: 'Toyota', result: secondId },
    { label: 'Модель', value: 'Camry', result: secondId },
    { label: 'Год', value: '2019', result: thirdId },
    { label: 'Категория деталей', value: 'ДВС / Двигатели', result: secondId },
    { label: 'Район', value: 'Al Quoz', result: secondId },
  ]) {
    await page.getByRole('button', { name: 'Фильтры поставщиков', exact: true }).click();
    await filters.getByRole('combobox', { name: item.label, exact: true }).selectOption(item.value);
    await filters.getByRole('button', { name: 'Показать поставщиков', exact: true }).click();
    await expect.poll(() => ids(page)).toEqual([item.result]);
    await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
    await expect(cards(page)).toHaveCount(3);
  }

  await page.getByRole('button', { name: 'Фильтры поставщиков', exact: true }).click();
  await filters.getByRole('combobox', { name: 'Марка', exact: true }).selectOption('BMW');
  await filters.getByRole('combobox', { name: 'Модель', exact: true }).selectOption('3 Series');
  await filters.getByRole('combobox', { name: 'Год', exact: true }).selectOption('2017');
  await filters
    .getByRole('combobox', { name: 'Категория деталей', exact: true })
    .selectOption('Кузовные детали');
  await filters.getByRole('combobox', { name: 'Район', exact: true }).selectOption('Sajaa');
  await filters.getByRole('checkbox', { name: 'Быстрый ответ в WhatsApp', exact: true }).check();
  await filters.getByRole('button', { name: 'Показать поставщиков', exact: true }).click();
  await expect(filters).toHaveCount(0);
  await expect.poll(() => ids(page)).toEqual([firstId]);
  await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
  await expect(cards(page)).toHaveCount(3);

  await page.getByRole('button', { name: 'Сортировка поставщиков', exact: true }).click();
  const sorting = page.getByRole('dialog', { name: 'Сортировка поставщиков', exact: true });
  await sorting.getByRole('button', { name: 'По названию', exact: true }).click();
  await expect.poll(() => ids(page)).toEqual([secondId, firstId, thirdId]);
  await page.getByRole('button', { name: 'Сортировка поставщиков', exact: true }).click();
  await sorting.getByRole('button', { name: 'Сначала закреплённые', exact: true }).click();
  expect((await ids(page))[0]).toBe(firstId);
  await page.getByRole('button', { name: 'Сортировка поставщиков', exact: true }).click();
  await sorting.getByRole('button', { name: 'Недавно обновлённые', exact: true }).click();
  await expect.poll(() => ids(page)).toEqual([thirdId, secondId, firstId]);
  await search.fill('Несуществующий контакт');
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Ничего не найдено', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).first().click();
  await expect(search).toHaveValue('');
  await expect.poll(async () => (await ids(page)).sort()).toEqual([firstId, secondId, thirdId]);
});

test('a short supplier menu enters neutrally and its close action is reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 500 });
  await seed(page, [supplier(firstId, { name: longName })]);
  const trigger = card(page, firstId).getByRole('button', {
    name: 'Действия поставщика',
    exact: true,
  });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await expect(menu(page).locator('.ui-modal-layer')).toBeFocused();
  await expect(menu(page).locator('button:focus,input:focus,a:focus')).toHaveCount(0);
  const close = menu(page).getByRole('button', { name: 'Закрыть', exact: true }).last();
  await close.scrollIntoViewIfNeeded();
  const bounds = await close.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(500);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog[open]')))).toBe(
    true,
  );
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await close.click();
  await expect(menu(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('favorite failures preserve the saved state and retry survives a reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await seed(page, [supplier(firstId)]);
  const activityBefore = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('dubai_spares_local_notifications_v2') || '[]').filter(
      (item: { entityType?: string }) => item.entityType === 'supplier',
    ),
  );
  await installWriteFailure(page);
  const favorite = card(page, firstId).getByRole('button', {
    name: 'Добавить в избранное: Mahmud BMW Parts',
    exact: true,
  });
  await favorite.click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: /сохран|избранн/ })
      .first(),
  ).toBeVisible();
  expect((await stored(page))[0].isFavorite).not.toBe(true);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('dubai_spares_local_notifications_v2') || '[]').filter(
        (item: { entityType?: string }) => item.entityType === 'supplier',
      ),
    ),
  ).toEqual(activityBefore);
  await expect(favorite).toHaveAttribute('aria-pressed', 'false');
  await failWrites(page, false);
  await favorite.click();
  await expect.poll(async () => (await stored(page))[0].isFavorite).toBe(true);
  await expect(
    card(page, firstId).getByRole('button', {
      name: 'Убрать из избранного: Mahmud BMW Parts',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await page.getByRole('button', { name: 'Избранные поставщики', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  expect((await stored(page))[0].isFavorite).toBe(true);
  expect(errors).toEqual([]);
});

test('create and edit failures keep drafts and editing preserves supplier history', async ({
  page,
}) => {
  const original = supplier(firstId, {
    isPinned: true,
    priority: 'high',
    status: 'visited',
    radarCount: 7,
    heatLevel: 4,
    supplierStatus: 'trusted',
    activeOrderIds: ['82000000-0000-4000-8000-000000000001'],
    linkedParts: [
      {
        id: 'legacy-link',
        orderId: '82000000-0000-4000-8000-000000000001',
        orderLabel: 'BMW 3 Series',
        partId: 'legacy-part',
        partName: 'Передний бампер',
        status: 'found',
        priceAed: 500,
        source: 'manual',
        updatedAt: Date.now(),
      },
    ],
    interactions: [
      {
        id: 'legacy-interaction',
        supplierId: firstId,
        type: 'visit',
        date: Date.now(),
        createdAt: Date.now(),
        note: 'Сохранить историю визита',
      },
    ],
    photos: [photo],
    photoUrl: photo,
    shopPhotos: [photo],
    internalNotes: 'Отдельная внутренняя заметка',
    ordersCompleted: 12,
    supplierScore: 85,
    lastVisitedAt: Date.now() - 2000,
    lastRespondedAt: Date.now() - 1000,
  });
  await seed(page, [original]);
  await page.getByRole('button', { name: 'Добавить поставщика', exact: true }).click();
  await expect(form(page).locator('.ui-modal-layer')).toBeFocused();
  const createName = 'BMW / McLaren Parts UAE';
  const name = form(page).getByRole('textbox', { name: 'Название поставщика', exact: true });
  await name.fill(createName);
  await installWriteFailure(page);
  await form(page).locator('button[type="submit"]').click();
  await expect(form(page).getByRole('alert')).toContainText(/сохран/);
  await expect(name).toHaveValue(createName);
  expect(await stored(page)).toHaveLength(1);
  const retryId = await page.evaluate((supplierName) => {
    const state = window as Window & { failedSupplierPayloads?: Supplier[][] };
    const payloads = state.failedSupplierPayloads || [];
    return payloads[payloads.length - 1]?.find((item) => item.name === supplierName)?.id;
  }, createName);
  expect(retryId).toBeTruthy();
  await failWrites(page, false);
  await form(page).locator('button[type="submit"]').click();
  await expect(form(page)).toHaveCount(0);
  await expect.poll(async () => (await stored(page)).length).toBe(2);
  const created = (await stored(page)).find((item) => item.name === createName)!;
  expect(created).toBeTruthy();
  expect(created.id).toBe(retryId);
  expect(created.phone).toBe('');
  expect(created.location).toBe('');

  await openMenu(page, firstId);
  await menu(page).getByRole('button', { name: 'Редактировать', exact: true }).click();
  const editedName = 'Mahmud BMW OEM & Performance Parts';
  await form(page)
    .getByRole('textbox', { name: 'Название поставщика', exact: true })
    .fill(editedName);
  const phone = form(page).getByRole('textbox', { name: 'Телефон с кодом страны', exact: true });
  await phone.fill('+971505556666');
  await failWrites(page, true);
  await form(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(form(page).getByRole('alert')).toContainText(/сохран/);
  await expect(phone).toHaveValue('+971505556666');
  expect((await stored(page)).find((item) => item.id === firstId)?.name).toBe(original.name);
  await failWrites(page, false);
  await form(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(form(page)).toHaveCount(0);
  const edited = (await stored(page)).find((item) => item.id === firstId)!;
  expect(edited.name).toBe(editedName);
  expect(edited.phone).toBe('+971505556666');
  for (const field of [
    'whatsapp',
    'isPinned',
    'priority',
    'status',
    'radarCount',
    'heatLevel',
    'supplierStatus',
    'activeOrderIds',
    'linkedParts',
    'interactions',
    'photos',
    'photoUrl',
    'shopPhotos',
    'internalNotes',
    'ordersCompleted',
    'supplierScore',
    'lastVisitedAt',
    'lastRespondedAt',
    'createdAt',
  ] as const) {
    expect(edited[field], `editing must preserve ${field}`).toEqual(original[field]);
  }
  await page.reload();
  await expect(card(page, firstId)).toContainText(editedName);
  expect((await stored(page)).find((item) => item.id === firstId)?.whatsapp).toBe(
    original.whatsapp,
  );
});

test('only valid contacts open phone and WhatsApp links and an invalid edit remains open', async ({
  page,
}) => {
  await seed(page, [
    supplier(firstId),
    supplier(secondId, { name: 'No Contact Parts', phone: '', whatsapp: '' }),
    supplier(thirdId, { name: 'Invalid Legacy Parts', phone: '12', whatsapp: 'not a phone' }),
  ]);
  await page.evaluate(() => {
    const state = window as Window & { supplierLinkCalls?: string[] };
    state.supplierLinkCalls = [];
    window.open = ((url?: string | URL) => {
      state.supplierLinkCalls!.push(String(url));
      return {} as Window;
    }) as typeof window.open;
  });
  const valid = card(page, firstId);
  await valid.getByRole('button', { name: 'WhatsApp: Mahmud BMW Parts', exact: true }).click();
  await valid.getByRole('button', { name: 'Позвонить: Mahmud BMW Parts', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as Window & { supplierLinkCalls?: string[] }).supplierLinkCalls,
    ),
  ).toEqual(['https://wa.me/971509876543', 'tel:+971501234567']);
  for (const id of [secondId, thirdId]) {
    const invalid = card(page, id);
    await expect(invalid.getByRole('button', { name: /^(?:WhatsApp|Позвонить):/ })).toHaveCount(0);
    await expect(invalid.getByRole('button', { name: /^Добавить контакт:/ })).toBeVisible();
  }
  await card(page, secondId)
    .getByRole('button', { name: 'Добавить контакт: No Contact Parts', exact: true })
    .click();
  const contact = page.getByRole('dialog', { name: 'Контакты поставщика', exact: true });
  await expect(contact.locator('.ui-modal-layer')).toBeFocused();
  const phone = contact.getByRole('textbox', { name: 'Телефон поставщика', exact: true });
  const whatsapp = contact.getByRole('textbox', { name: 'WhatsApp поставщика', exact: true });
  await phone.fill('+971508887777');
  await whatsapp.fill('123');
  await contact.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(contact.getByRole('alert')).toBeVisible();
  await expect(whatsapp).toHaveValue('123');
  expect((await stored(page)).find((item) => item.id === secondId)?.phone).toBe('');
  expect(
    await page.evaluate(
      () => (window as Window & { supplierLinkCalls?: string[] }).supplierLinkCalls,
    ),
  ).toEqual(['https://wa.me/971509876543', 'tel:+971501234567']);
  await whatsapp.fill('+971501112222');
  await contact.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(contact).toHaveCount(0);
  await card(page, secondId)
    .getByRole('button', { name: 'WhatsApp: No Contact Parts', exact: true })
    .click();
  expect(
    await page.evaluate(() => {
      const calls = (window as Window & { supplierLinkCalls?: string[] }).supplierLinkCalls || [];
      return calls[calls.length - 1];
    }),
  ).toBe('https://wa.me/971501112222');
  expect((await stored(page)).find((item) => item.id === secondId)?.phone).toBe('+971508887777');
});

test('delete cancellation and failed storage preserve suppliers until deletion succeeds', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await seed(page, [supplier(firstId), supplier(secondId, { name: 'Keep Toyota Parts' })]);
  await openMenu(page, firstId);
  await menu(page).getByRole('button', { name: 'Удалить', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Подтвердите действие', exact: true });
  await expect(confirmation.locator('.ui-modal-layer')).toBeFocused();
  await expect(confirmation.locator('button:focus')).toHaveCount(0);
  await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(cards(page)).toHaveCount(2);
  expect(await stored(page)).toHaveLength(2);

  await openMenu(page, firstId);
  await menu(page).getByRole('button', { name: 'Удалить', exact: true }).click();
  await installWriteFailure(page);
  await confirmation.getByRole('button', { name: 'Да, удалить', exact: true }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: /удал|сохран/ })
      .first(),
  ).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  expect(await stored(page)).toHaveLength(2);
  await failWrites(page, false);
  if (!(await confirmation.count())) {
    await openMenu(page, firstId);
    await menu(page).getByRole('button', { name: 'Удалить', exact: true }).click();
  }
  await confirmation.getByRole('button', { name: 'Да, удалить', exact: true }).click();
  await expect(card(page, firstId)).toHaveCount(0);
  await expect(card(page, secondId)).toBeVisible();
  expect((await stored(page)).map((item) => item.id)).toEqual([secondId]);
  await page.reload();
  await expect(cards(page)).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('order links survive failed writes, block conflicting actions and preserve manual specialization when removed', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const orderId = '82000000-0000-4000-8000-000000000001';
  const partIds = ['83000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000002'];
  const original = supplier(firstId, {
    name: 'Manual Toyota & Lexus Parts',
    brands: ['Toyota', 'Lexus'],
    mainBrands: ['Toyota', 'Lexus'],
    primaryBrand: 'Toyota',
    models: ['Camry', 'RX'],
    years: [2015, 2020],
    activeOrderIds: [],
    linkedParts: [],
  });
  const order: Order = {
    id: orderId,
    brand: 'BMW',
    model: '3 Series',
    year: '2017',
    vin: 'WBA8E91090A123456',
    clientName: 'Link Buyer',
    priority: Priority.MEDIUM,
    source: Source.WHATSAPP,
    status: 'active',
    isArchived: false,
    isSold: false,
    searchDepositStatus: 'paid',
    paymentStatus: 'search_deposit_paid',
    parts: partIds.map((id, index) => ({
      id,
      name: index ? 'Задний бампер' : 'Передний бампер',
      isFound: false,
      variants: [],
    })),
    notes: [],
    markupPercent: 0,
    exchangeRate: 3.67,
    createdAt: Date.now(),
    vendorContacts: [],
    recommendedShopIds: [],
    dismissedShopIds: [],
  };
  await seed(page, [original]);
  await page.evaluate(async (row) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dubai-spares-offline');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('orders', 'readwrite');
      const store = transaction.objectStore('orders');
      store.clear();
      store.put(row);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  }, order);
  await page.reload();
  const readOrder = () =>
    page.evaluate(async (id) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('dubai-spares-offline');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const row = await new Promise<Order>((resolve, reject) => {
        const request = db.transaction('orders').objectStore('orders').get(id);
        request.onsuccess = () => resolve(request.result as Order);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return row;
    }, orderId);
  const radar = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('radar_manual_supplier_parts') || '[]'));
  await card(page, firstId)
    .getByRole('button', { name: `Открыть поставщика: ${original.name}`, exact: true })
    .click();
  const profile = page.getByRole('dialog', { name: 'Карточка поставщика', exact: true });
  await profile.getByRole('button', { name: /Привязать к заказу/ }).click();
  const choice = profile.getByRole('combobox', { name: 'Выберите заказ', exact: true });
  await choice.selectOption(orderId);
  const link = profile.getByRole('button', { name: 'Привязать', exact: true });

  await page.evaluate(() => {
    type PendingLink = { held: boolean; holdNext: boolean; release?: () => void };
    const state = window as Window & {
      supplierOrderWriteFails?: boolean;
      pendingSupplierLink?: PendingLink;
    };
    state.supplierOrderWriteFails = true;
    state.pendingSupplierLink = { held: false, holdNext: false };
    const heldTransactions = new WeakSet<IDBTransaction>();
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'orders' && state.supplierOrderWriteFails)
        throw new DOMException('QA order quota', 'QuotaExceededError');
      if (this.name === 'orders' && state.pendingSupplierLink!.holdNext) {
        heldTransactions.add(this.transaction);
        state.pendingSupplierLink!.holdNext = false;
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
          state.pendingSupplierLink!.held = true;
          state.pendingSupplierLink!.release = () => listener?.call(transaction, event);
        });
      },
    });
  });
  await link.click();
  await expect(profile.getByRole('alert')).toBeVisible();
  await expect(choice).toHaveValue(orderId);
  await expect(link).toBeEnabled();
  expect((await readOrder()).recommendedShopIds).toEqual([]);
  expect((await readOrder()).vendorContacts).toEqual([]);
  expect((await stored(page))[0].activeOrderIds).toEqual([]);
  expect((await stored(page))[0].linkedParts).toEqual([]);
  expect(await radar()).toEqual([]);
  await expect(page.getByText('Поставщик привязан к заказу', { exact: true })).toHaveCount(0);

  await page.evaluate(() => {
    (window as Window & { supplierOrderWriteFails?: boolean }).supplierOrderWriteFails = false;
  });
  await installWriteFailure(page);
  await link.click();
  await expect(profile.getByRole('alert')).toContainText('Не удалось сохранить связь');
  await expect(choice).toHaveValue(orderId);
  await expect(link).toBeEnabled();
  expect((await readOrder()).recommendedShopIds).toEqual([]);
  expect((await readOrder()).vendorContacts).toEqual([]);
  expect((await stored(page))[0].activeOrderIds).toEqual([]);
  expect((await stored(page))[0].linkedParts).toEqual([]);
  expect(await radar()).toEqual([]);
  await expect(page.getByText('Поставщик привязан к заказу', { exact: true })).toHaveCount(0);

  await failWrites(page, false);
  await page.evaluate(() => {
    (
      window as Window & { pendingSupplierLink?: { holdNext: boolean } }
    ).pendingSupplierLink!.holdNext = true;
  });
  await link.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { pendingSupplierLink?: { held: boolean } }).pendingSupplierLink
            ?.held,
      ),
    )
    .toBe(true);
  await expect(choice).toBeDisabled();
  await expect(link).toBeDisabled();
  await expect(profile.getByRole('button', { name: 'Закрыть', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(profile).toBeVisible();
  await expect(choice).toHaveValue(orderId);
  await page.evaluate(() => {
    (
      window as Window & { pendingSupplierLink?: { release?: () => void } }
    ).pendingSupplierLink?.release?.();
  });
  await expect(choice).toHaveCount(0);
  await expect.poll(async () => (await readOrder()).recommendedShopIds).toEqual([firstId]);
  expect((await readOrder()).vendorContacts).toHaveLength(1);
  const linked = (await stored(page))[0];
  expect(linked.activeOrderIds).toEqual([orderId]);
  expect(linked.linkedParts?.map((entry) => entry.partId).sort()).toEqual(partIds);
  expect(await radar()).toHaveLength(2);

  await profile.getByRole('button', { name: 'Убрать', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Подтвердите действие', exact: true });
  await page.evaluate(() => {
    (window as Window & { supplierOrderWriteFails?: boolean }).supplierOrderWriteFails = true;
  });
  await confirmation.getByRole('button', { name: 'Да, удалить', exact: true }).click();
  await expect(confirmation.getByRole('alert')).toBeVisible();
  expect((await readOrder()).recommendedShopIds).toEqual([firstId]);
  expect((await stored(page))[0].activeOrderIds).toEqual([orderId]);
  expect((await stored(page))[0].linkedParts).toHaveLength(2);
  expect(await radar()).toHaveLength(2);
  await page.evaluate(() => {
    (window as Window & { supplierOrderWriteFails?: boolean }).supplierOrderWriteFails = false;
  });
  await confirmation.getByRole('button', { name: 'Да, удалить', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  expect((await readOrder()).recommendedShopIds).toEqual([]);
  expect((await readOrder()).vendorContacts).toEqual([]);
  const unlinked = (await stored(page))[0];
  expect(unlinked.activeOrderIds).toEqual([]);
  expect(unlinked.linkedParts).toEqual([]);
  expect(unlinked.mainBrands).toEqual(expect.arrayContaining(original.mainBrands!));
  expect(unlinked.models).toEqual(expect.arrayContaining(original.models!));
  expect(unlinked.years).toEqual(expect.arrayContaining(original.years!));
  expect(await radar()).toEqual([]);
  expect(errors).toEqual([]);
});

test('supplier editors and profile keep focused fields and actions above an overlaid keyboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, [
    supplier(firstId, { name: 'Keyboard Parts', phone: '', whatsapp: '' }),
    supplier(secondId, { name: longName }),
  ]);
  const shrinkViewport = async () => {
    await page.evaluate(() => {
      const viewport = window.visualViewport!;
      const names = ['height', 'offsetTop'];
      const state = window as Window & { restoreSupplierKeyboardViewport?: () => void };
      state.restoreSupplierKeyboardViewport?.();
      const originals = names.map((name) => Object.getOwnPropertyDescriptor(viewport, name));
      state.restoreSupplierKeyboardViewport = () => {
        names.forEach((name, index) => {
          const original = originals[index];
          if (original) Object.defineProperty(viewport, name, original);
          else Reflect.deleteProperty(viewport, name);
        });
        viewport.dispatchEvent(new Event('resize'));
      };
      Object.defineProperty(viewport, 'height', { configurable: true, value: 280 });
      Object.defineProperty(viewport, 'offsetTop', { configurable: true, value: 20 });
      viewport.dispatchEvent(new Event('resize'));
    });
  };
  const restoreViewport = async () => {
    await page.evaluate(() => {
      const state = window as Window & { restoreSupplierKeyboardViewport?: () => void };
      state.restoreSupplierKeyboardViewport?.();
      delete state.restoreSupplierKeyboardViewport;
    });
    await expect.poll(() => page.evaluate(() => window.visualViewport!.height)).toBe(844);
  };
  const checkField = async (
    input: Locator,
    scrollSelector: string,
    footerSelector?: string,
    headerSelector?: string,
  ) => {
    await expect(async () => {
      const geometry = await input.evaluate(
        (element, selectors) => {
          const dialog = element.closest('dialog')!;
          const bounds = (node: Element) => node.getBoundingClientRect().toJSON();
          const input = bounds(element);
          const scroll = dialog.querySelector(selectors.scroll)!;
          const footer = selectors.footer ? dialog.querySelector(selectors.footer)! : null;
          const header = selectors.header ? dialog.querySelector(selectors.header)! : null;
          return {
            input,
            scroll: bounds(scroll),
            footer: footer ? bounds(footer) : null,
            header: header ? bounds(header) : null,
            actions: footer ? Array.from(footer.querySelectorAll('button')).map(bounds) : [],
            fontSize: parseFloat(getComputedStyle(element).fontSize),
            focused: document.activeElement === element,
            reachable:
              document.elementFromPoint(input.x + input.width / 2, input.y + input.height / 2) ===
              element,
            pageWidth: document.documentElement.scrollWidth,
          };
        },
        { scroll: scrollSelector, footer: footerSelector, header: headerSelector },
      );
      expect(geometry.fontSize).toBeGreaterThanOrEqual(16);
      expect(geometry.input.height).toBeGreaterThanOrEqual(44);
      expect(geometry.input.top).toBeGreaterThanOrEqual(Math.max(20, geometry.scroll.top) - 1);
      expect(geometry.input.bottom).toBeLessThanOrEqual(Math.min(300, geometry.scroll.bottom) + 1);
      expect(geometry.focused).toBe(true);
      expect(
        geometry.reachable,
        'focused field must receive a tap instead of the footer or header',
      ).toBe(true);
      expect(geometry.pageWidth).toBeLessThanOrEqual(390);
      if (geometry.header)
        expect(geometry.input.top).toBeGreaterThanOrEqual(geometry.header.bottom - 1);
      if (geometry.footer) {
        expect(geometry.input.bottom).toBeLessThanOrEqual(geometry.footer.top + 1);
        expect(geometry.footer.top).toBeGreaterThanOrEqual(20);
        expect(geometry.footer.bottom).toBeLessThanOrEqual(300);
        expect(geometry.actions).toHaveLength(2);
        for (const action of geometry.actions) {
          expect(action.height).toBeGreaterThanOrEqual(44);
          expect(action.width).toBeGreaterThanOrEqual(44);
          expect(action.top).toBeGreaterThanOrEqual(20);
          expect(action.bottom).toBeLessThanOrEqual(300);
        }
      }
    }).toPass({ timeout: 10_000 });
  };

  try {
    const addTrigger = page.getByRole('button', { name: 'Добавить поставщика', exact: true });
    await addTrigger.click();
    const editor = form(page);
    await expect(editor.locator('.ui-modal-layer')).toBeFocused();
    await expect(editor.locator('button:focus,input:focus')).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(editor.getByRole('button', { name: 'Закрыть форму', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    const name = editor.getByRole('textbox', { name: 'Название поставщика', exact: true });
    await expect(name).toBeFocused();
    await shrinkViewport();
    await expect(editor.locator('.supplier-editor-frame')).toHaveCSS('height', '280px');
    await expect(editor.locator('.supplier-editor-frame')).toHaveCSS('top', '20px');
    await checkField(name, '.supplier-editor-fields', '.supplier-editor-panel > div:last-child');
    await name.fill('Keyboard BMW Parts');
    await page.keyboard.press('Tab');
    const phone = editor.getByRole('textbox', { name: 'Телефон с кодом страны', exact: true });
    await expect(phone).toBeFocused();
    await checkField(phone, '.supplier-editor-fields', '.supplier-editor-panel > div:last-child');
    await editor.getByRole('button', { name: 'Дополнительно', exact: true }).click();
    const comment = editor.getByRole('textbox', { name: 'Комментарий', exact: true });
    await comment.focus();
    await checkField(comment, '.supplier-editor-fields', '.supplier-editor-panel > div:last-child');
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(addTrigger).toBeFocused();
    await restoreViewport();

    const contactTrigger = card(page, firstId).getByRole('button', {
      name: 'Добавить контакт: Keyboard Parts',
      exact: true,
    });
    await contactTrigger.click();
    const contact = page.getByRole('dialog', { name: 'Контакты поставщика', exact: true });
    await expect(contact.locator('.ui-modal-layer')).toBeFocused();
    await expect(contact.locator('button:focus,input:focus')).toHaveCount(0);
    await page.keyboard.press('Tab');
    const contactPhone = contact.getByRole('textbox', { name: 'Телефон поставщика', exact: true });
    await expect(contactPhone).toBeFocused();
    await shrinkViewport();
    await expect(contact.locator('.supplier-contact-frame')).toHaveCSS('height', '280px');
    await expect(contact.locator('.supplier-contact-frame')).toHaveCSS('top', '20px');
    await checkField(contactPhone, '.supplier-contact-fields', '.supplier-contact-panel > footer');
    await page.keyboard.press('Tab');
    const whatsapp = contact.getByRole('textbox', { name: 'WhatsApp поставщика', exact: true });
    await expect(whatsapp).toBeFocused();
    await checkField(whatsapp, '.supplier-contact-fields', '.supplier-contact-panel > footer');
    await page.keyboard.press('Escape');
    await expect(contact).toHaveCount(0);
    await expect(contactTrigger).toBeFocused();
    await restoreViewport();

    const profileTrigger = card(page, secondId).getByRole('button', {
      name: `Открыть поставщика: ${longName}`,
      exact: true,
    });
    await profileTrigger.click();
    const profile = page.getByRole('dialog', { name: 'Карточка поставщика', exact: true });
    await expect(profile.locator('.ui-modal-layer')).toBeFocused();
    await expect(profile.locator('button:focus,input:focus')).toHaveCount(0);
    await profile.getByRole('button', { name: /Привязать к заказу/ }).click();
    const search = profile.getByRole('textbox', { name: 'Поиск связанного заказа', exact: true });
    await search.focus();
    await shrinkViewport();
    await expect(profile.locator('.supplier-profile-frame')).toHaveCSS('height', '280px');
    await expect(profile.locator('.supplier-profile-frame')).toHaveCSS('top', '20px');
    await checkField(
      search,
      '.supplier-profile-panel > div',
      undefined,
      '.supplier-profile-panel .sticky',
    );
    await search.fill('BMW');
    await page.keyboard.press('Tab');
    const orderChoice = profile.getByRole('combobox', { name: 'Выберите заказ', exact: true });
    await expect(orderChoice).toBeFocused();
    await checkField(
      orderChoice,
      '.supplier-profile-panel > div',
      undefined,
      '.supplier-profile-panel .sticky',
    );
    await page.keyboard.press('Escape');
    await expect(profile).toHaveCount(0);
    await expect(profileTrigger).toBeFocused();
    await restoreViewport();
  } finally {
    await restoreViewport();
  }
});
