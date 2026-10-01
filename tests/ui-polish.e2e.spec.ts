import { expect, test } from '@playwright/test';

test('order draft survives reload, keyboard selection returns focus and saving clears the draft', async ({
  page,
}) => {
  await page.goto('/#/new');
  await page.getByPlaceholder('Введите модель').fill('Camry');
  await page.locator('input[name="clientName"]').fill('Draft Buyer');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('dubai_spares_draft_new_order_v1') || 'null')?.data.model,
      ),
    )
    .toBe('Camry');
  await page.reload();
  await expect(page.getByPlaceholder('Введите модель')).toHaveValue('Camry');
  await expect(page.locator('input[name="clientName"]')).toHaveValue('Draft Buyer');
  await page.getByRole('button', { name: 'Марка', exact: true }).click();
  const brands = page.getByRole('combobox', { name: 'Поиск: Марка', exact: true });
  await brands.fill('Toyota');
  await brands.press('Enter');
  await expect(page.getByRole('button', { name: 'Марка', exact: true })).toBeFocused();
  await page.getByPlaceholder('Введите модель').fill('Camry');
  await page.getByRole('button', { name: 'Год', exact: true }).click();
  const years = page.getByRole('combobox', { name: 'Поиск: Год', exact: true });
  await years.fill('2020');
  await years.press('Enter');
  await page.getByRole('button', { name: 'Создать заказ', exact: true }).click();
  await page.waitForURL(/#\/order\//);
  expect(
    await page.evaluate(() => localStorage.getItem('dubai_spares_draft_new_order_v1')),
  ).toBeNull();
});

test('new order validation identifies and focuses the first missing field', async ({ page }) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: 'Создать заказ', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Марка', exact: true })).toBeFocused();
  await expect(page.getByText('Марка обязательна', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Марка', exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
});

test('statistics dialog traps keyboard focus, locks the background and returns focus on Escape', async ({
  page,
}) => {
  await page.goto('/#/orders');
  const trigger = page.getByRole('button', { name: 'Статистика', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Доход компании', exact: true });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => Boolean(document.activeElement?.closest('dialog[open]'))),
    ).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('variant prices retain decimal values when creating and editing', async ({ page }) => {
  await page.goto('/#/variants');
  await page.getByRole('button', { name: 'Новый вариант', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Новый вариант', exact: true });
  await create
    .getByRole('textbox', { name: 'Название поставщика', exact: true })
    .fill('Real Parts');
  await create
    .getByRole('textbox', { name: 'Название детали', exact: true })
    .fill('Decimal bumper');
  await create.getByRole('textbox', { name: 'Цена закупки, AED', exact: true }).fill('450,50');
  await create.getByRole('textbox', { name: 'Цена продажи, AED', exact: true }).fill('520,75');
  await create.getByRole('button', { name: 'Сохранить вариант', exact: true }).click();
  await expect(create).toHaveCount(0);
  await page.getByRole('button', { name: 'Открыть вариант: Decimal bumper', exact: true }).click();
  const detail = page.getByRole('dialog', { name: 'Карточка варианта', exact: true });
  await detail.getByRole('button', { name: 'Редактировать', exact: true }).click();
  const price = detail.getByRole('textbox', { name: 'Цена продажи, AED', exact: true });
  await price.fill('530');
  await price.press(',');
  await price.press('5');
  await price.press('0');
  await detail.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('dubai_spares_standalone_variants') || '[]')[0],
  );
  expect(saved.purchasePriceAed).toBe(450.5);
  expect(saved.salePriceAed).toBe(530.5);
});

test('nested photo viewer closes independently and restores the parent dialog focus', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'dubai_spares_standalone_variants',
      JSON.stringify([
        {
          id: 'nested-photo',
          origin: 'standalone',
          sourcePartName: 'Photo bumper',
          shopName: 'Photo Parts',
          priceAed: 100,
          condition: 'used',
          availability: 'in_stock',
          createdAt: Date.now(),
          photos: [
            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect width="100" height="100" fill="blue"/%3E%3C/svg%3E',
          ],
        },
      ]),
    ),
  );
  await page.goto('/#/variants');
  await page.getByRole('button', { name: 'Открыть вариант: Photo bumper', exact: true }).click();
  const parent = page.getByRole('dialog', { name: 'Карточка варианта', exact: true });
  const photo = parent.getByRole('button', { name: 'Открыть фото 1', exact: true });
  await photo.click();
  const viewer = page.getByRole('dialog', { name: 'Просмотр фотографий', exact: true });
  await expect(viewer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(parent).toBeVisible();
  await expect(photo).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await page.keyboard.press('Escape');
  await expect(parent).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('settings tabs support keyboard selection and focus movement', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByRole('tab', { name: 'Основные', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Компания', exact: true })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Компания', exact: true })).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Система', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Основные', exact: true })).toBeFocused();
});

test('public request restores the current step and focuses contact errors before saving', async ({
  page,
}) => {
  await page.goto('/#/request');
  await page.getByLabel('Марка *', { exact: true }).selectOption('Toyota');
  await page.getByLabel('Модель *', { exact: true }).fill('Camry');
  await page.getByLabel('Год выпуска *', { exact: true }).selectOption('2020');
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await page.getByLabel('Деталь 1', { exact: true }).fill('Front bumper');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('dubai_spares_draft_public_request_v1') || 'null')?.data
            .parts[0],
      ),
    )
    .toBe('Front bumper');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Какие детали нужны?', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Деталь 1', { exact: true })).toHaveValue('Front bumper');
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить заявку', exact: true }).click();
  await expect(page.getByLabel('Имя *', { exact: true })).toBeFocused();
  await page.getByLabel('Имя *', { exact: true }).fill('Public Buyer');
  await page.getByLabel('Телефон или WhatsApp *', { exact: true }).fill('abcde');
  await page.getByRole('button', { name: 'Сохранить заявку', exact: true }).click();
  await expect(page.getByLabel('Телефон или WhatsApp *', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Телефон или WhatsApp *', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.getByLabel('Телефон или WhatsApp *', { exact: true }).fill('+971501234567');
  await page.getByRole('button', { name: 'Сохранить заявку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Заявка сохранена', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem('dubai_spares_draft_public_request_v1')),
  ).toBeNull();
});

test('workspace keeps long names, headings and touch actions usable from 320 to 1440 pixels', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'dubai_spares_suppliers',
      JSON.stringify([
        {
          id: 'responsive-supplier',
          name: 'Al Noor Automotive Spare Parts Trading Company',
          phone: '+971501234567',
          brands: ['Toyota', 'Lexus'],
          type: 'used_parts',
          createdAt: Date.now(),
        },
      ]),
    );
    localStorage.setItem(
      'dubai_spares_standalone_variants',
      JSON.stringify([
        {
          id: 'responsive-variant',
          origin: 'standalone',
          sourcePartName: 'Передний бампер с креплениями и противотуманными фарами',
          shopName: 'Al Noor Automotive Spare Parts Trading Company',
          priceAed: 520.75,
          condition: 'used',
          availability: 'in_stock',
          createdAt: Date.now(),
        },
      ]),
    );
  });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of [
      'orders',
      'database',
      'variants',
      'settings',
      'notifications',
      'request',
      'trust',
      'morning',
    ]) {
      await page.goto(`/#/${route}`);
      const headings: Record<string, string | RegExp> = {
        orders: 'Заказы',
        database: 'Поставщики',
        variants: 'Варианты',
        settings: 'Настройки',
        notifications: 'Уведомления',
        request: /Найдём нужные/,
        trust: 'Безопасная покупка автозапчастей из Дубая',
        morning: /Доброе|Добрый/,
      };
      await expect(page.getByRole('heading', { name: headings[route], level: 1 })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        `${route} overflows at ${width}`,
      ).toBe(false);
      if (width < 900) {
        const tiny = await page.locator('button,a').evaluateAll((elements) =>
          elements
            .filter((element) => {
              const box = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              if (
                box.width < 2 ||
                box.height < 2 ||
                box.right <= 0 ||
                box.left >= innerWidth ||
                box.bottom <= 0 ||
                box.top >= innerHeight ||
                style.visibility === 'hidden' ||
                style.clipPath === 'inset(50%)'
              )
                return false;
              return box.width < 43.5 || box.height < 43.5;
            })
            .map((element) => element.getAttribute('aria-label') || element.textContent?.trim()),
        );
        expect(tiny, `${route} has small actions at ${width}`).toEqual([]);
      }
    }
  }
});
