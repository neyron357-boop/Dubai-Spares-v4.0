import { expect, test, type Locator, type Page } from '@playwright/test';
const orderId = '90000000-0000-4000-8000-000000000001';
test.use({ viewport: { width: 390, height: 844 } });
const message = (page: Page, id: string) => page.locator(`[data-chat-message-id="${id}"]`);
async function seed(page: Page) {
  await page.goto('/#/orders');
  await expect(page.getByRole('heading', { name: 'Заказы', exact: true })).toBeVisible();
  await page.evaluate(async (id) => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const now = today.getTime();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const photo =
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#cfe3e9"/><path d="M70 310L115 210L430 210L550 310Z" fill="#344a65"/><circle cx="175" cy="320" r="40" fill="#172333"/><circle cx="455" cy="320" r="40" fill="#172333"/></svg>',
      );
    const samples = 16000;
    const wav = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(wav);
    const word = (n: number, text: string) => {
      [...text].forEach((char, i) => view.setUint8(n + i, char.charCodeAt(0)));
    };
    word(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    word(8, 'WAVE');
    word(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    word(36, 'data');
    view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++)
      view.setInt16(44 + i * 2, Math.sin((i / 16000) * 440 * Math.PI * 2) * 10000, true);
    const audio = 'data:audio/wav;base64,' + btoa(String.fromCharCode(...new Uint8Array(wav)));
    const notes = [
      {
        id: 'text',
        text: 'Поставщик подтвердил наличие.\nЗабрать завтра 🙂',
        createdAt: now + 180000,
      },
      { id: 'photo', text: 'Образец детали', photos: [photo], createdAt: yesterday.getTime() },
      {
        id: 'voice',
        text: '',
        audios: [
          {
            id: 'chat-voice',
            fileUrl: audio,
            duration: 1,
            createdAt: now,
            author: 'QA',
            waveform: Array.from({ length: 40 }, (_, i) => 15 + (i % 10) * 7),
          },
        ],
        createdAt: now,
      },
      {
        id: 'album',
        text: 'Все ракурсы',
        photos: Array.from({ length: 6 }, (_, index) =>
          photo.replace(
            'cfe3e9',
            ['cfe3e9', 'cfe9d1', 'e9d9cf', 'e2cfe9', 'e9e5cf', 'cfe9e7'][index],
          ),
        ),
        createdAt: now + 60000,
      },
      {
        id: 'file',
        text: 'Прайс',
        attachments: [
          {
            id: 'file-1',
            kind: 'file',
            name: 'Прайс поставщика.pdf',
            fileUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
            mimeType: 'application/pdf',
            size: 1024,
            createdAt: now,
          },
        ],
        createdAt: now + 120000,
      },
      {
        id: 'proof',
        text: 'Материал для клиента',
        photos: [photo],
        visibility: 'client',
        kind: 'proof',
        createdAt: now + 240000,
      },
    ];
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('dubai-spares-offline');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('orders', 'readwrite');
      tx.objectStore('orders').put({
        id,
        brand: 'BMW',
        model: '3 Series',
        year: '2017',
        clientName: 'Chat QA',
        parts: [],
        notes,
        status: 'in_progress',
        priority: 'medium',
        source: 'WhatsApp',
        createdAt: now,
        paymentStatus: 'search_deposit_paid',
        searchDepositStatus: 'paid',
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, orderId);
  await page.goto(`/#/order/${orderId}`);
  await page.reload();
  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await expect(page.locator('.chat-bubble')).toHaveCount(6);
}
async function hold(page: Page, element: Locator) {
  await element.scrollIntoViewIfNeeded();
  const box = (await element.boundingBox())!;
  await page.mouse.move(box.x + Math.min(35, box.width / 2), box.y + Math.min(25, box.height / 2));
  await page.mouse.down();
  await expect(
    page.getByRole('dialog', { name: 'Действия с сообщением', exact: true }),
  ).toBeVisible();
  await page.mouse.up();
}
async function storedIds(page: Page) {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('dubai-spares-offline');
      req.onsuccess = () => resolve(req.result);
    });
    const order = await new Promise<any>((resolve) => {
      const req = db.transaction('orders').objectStore('orders').get(id);
      req.onsuccess = () => resolve(req.result);
    });
    db.close();
    return order.notes.map((note: any) => note.id);
  }, orderId);
}

async function setVisibleViewport(
  page: Page,
  viewport: { height: number; offsetTop?: number; scale?: number },
) {
  await page.evaluate(async ({ height, offsetTop = 0, scale = 1 }) => {
    const visible = window.visualViewport;
    if (!visible) throw new Error('Visual viewport is unavailable');
    Object.defineProperties(visible, {
      height: { configurable: true, get: () => height },
      offsetTop: { configurable: true, get: () => offsetTop },
      scale: { configurable: true, get: () => scale },
    });
    visible.dispatchEvent(new Event('resize'));
    visible.dispatchEvent(new Event('scroll'));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }, viewport);
}

async function chatGeometry(page: Page) {
  return page.evaluate(() => {
    const bounds = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing chat layout element: ${selector}`);
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    };
    return {
      frame: bounds('.order-chat-workspace'),
      header: bounds('.order-chat-header'),
      tabs: bounds('.order-chat-tabs'),
      history: bounds('[data-chat-scroll]'),
      dock: bounds('.order-chat-dock'),
      documentScroll: window.scrollY,
      mainScroll: document.querySelector('main')?.scrollTop ?? 0,
      documentHeight: document.documentElement.scrollHeight,
    };
  });
}

async function expectChatFrame(page: Page, height: number, top = 0) {
  await expect
    .poll(async () => {
      const { frame, header, tabs, history, dock } = await chatGeometry(page);
      return (
        Math.abs(frame.top - top) <= 2 &&
        Math.abs(frame.height - height) <= 2 &&
        Math.abs(header.top - frame.top) <= 2 &&
        Math.abs(tabs.top - header.bottom) <= 2 &&
        Math.abs(history.top - tabs.bottom) <= 2 &&
        Math.abs(history.bottom - dock.top) <= 2 &&
        Math.abs(dock.bottom - frame.bottom) <= 2 &&
        history.height >= 100
      );
    })
    .toBe(true);
}

test('chronological chat has day separators, large media and no permanent delete/download controls', async ({
  page,
}) => {
  await seed(page);
  expect(
    await page
      .locator('.chat-bubble')
      .evaluateAll((nodes) => nodes.map((el) => el.getAttribute('data-chat-message-id'))),
  ).toEqual(['photo', 'voice', 'album', 'file', 'text', 'proof']);
  await expect(page.locator('.chat-day')).toHaveText(['Вчера', 'Сегодня']);
  await expect(page.locator('.chat-thread').getByRole('button', { name: /Удалить/ })).toHaveCount(
    0,
  );
  await expect(
    page.locator('.chat-thread').getByRole('link', { name: 'Скачать запись' }),
  ).toHaveCount(0);
  expect(
    await message(page, 'photo')
      .getByRole('button', { name: 'Открыть фотографию' })
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBeGreaterThan(220);
  await expect(message(page, 'text').locator('.chat-message-text')).toHaveText(
    'Поставщик подтвердил наличие.\nЗабрать завтра 🙂',
  );
  expect(
    await message(page, 'text')
      .locator('.chat-message-text')
      .evaluate((el) => getComputedStyle(el).whiteSpace),
  ).toBe('pre-wrap');
  await expect(message(page, 'voice').locator('time')).toHaveCount(1);
  await expect(
    message(page, 'album').getByRole('button', { name: 'Открыть фотографию' }),
  ).toHaveCount(4);
  await expect(message(page, 'album').getByText('+2', { exact: true })).toBeVisible();
  await message(page, 'album').getByRole('button', { name: 'Открыть фотографию' }).last().click();
  await expect(page.getByRole('dialog', { name: 'Просмотр фотографий' })).toBeVisible();
});

test('hold copies text; keyboard actions delete only the chosen message after confirmation', async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(() => {
    document.execCommand = () => {
      (window as any).chatCopied = (document.activeElement as HTMLTextAreaElement)?.value;
      return true;
    };
  });
  await hold(page, message(page, 'text'));
  await page.getByRole('button', { name: 'Копировать текст', exact: true }).click();
  expect(await page.evaluate(() => (window as any).chatCopied)).toBe(
    'Поставщик подтвердил наличие.\nЗабрать завтра 🙂',
  );
  await message(page, 'text').focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('button', { name: 'Удалить сообщение', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Удалить сообщение?', exact: true });
  await confirm.getByRole('button', { name: 'Отмена', exact: true }).click();
  expect(await storedIds(page)).toContain('text');
  await message(page, 'text').focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('button', { name: 'Удалить сообщение', exact: true }).click();
  await confirm.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(message(page, 'text')).toHaveCount(0);
  expect(await storedIds(page)).toEqual(['photo', 'voice', 'album', 'file', 'proof']);
  await page.reload();
  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await expect(page.locator('.chat-bubble')).toHaveCount(5);
});

test('right click on voice exposes its real file and Escape restores message focus', async ({
  page,
}) => {
  await seed(page);
  await message(page, 'voice').click({ button: 'right' });
  const menu = page.getByRole('dialog', { name: 'Действия с сообщением', exact: true });
  const link = menu.getByRole('link', { name: 'Сохранить файл', exact: true });
  await expect(link).toHaveAttribute('download', 'voice-chat-voice.wav');
  expect(await menu.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await expect(menu.locator('button:focus, a:focus, input:focus, textarea:focus')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  expect(await link.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(message(page, 'voice')).toBeFocused();
});

test('failed deletion retains message and confirmation; retry persists deletion', async ({
  page,
}) => {
  await seed(page);
  await message(page, 'text').click({ button: 'right' });
  await page.getByRole('button', { name: 'Удалить сообщение', exact: true }).click();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).chatFail = true;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'orders' && (window as any).chatFail)
        throw new DOMException('Full', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  const confirm = page.getByRole('dialog', { name: 'Удалить сообщение?', exact: true });
  await confirm.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(confirm.getByRole('alert')).toContainText('Сообщение осталось в истории');
  expect(await storedIds(page)).toContain('text');
  await page.evaluate(() => {
    (window as any).chatFail = false;
  });
  await confirm.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  expect(await storedIds(page)).not.toContain('text');
});

test('native touch scroll cancels the hold, long hold opens actions without opening the photo', async ({
  page,
  context,
}) => {
  await seed(page);
  const photo = message(page, 'proof').getByRole('button', { name: 'Открыть фотографию' });
  await photo.scrollIntoViewIfNeeded();
  const box = (await photo.boundingBox())!;
  const x = box.x + 40,
    y = box.y + 70;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: y - 60 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(650);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await photo.scrollIntoViewIfNeeded();
  const next = (await photo.boundingBox())!;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: next.x + 30, y: next.y + 50 }],
  });
  await expect(
    page.getByRole('dialog', { name: 'Действия с сообщением', exact: true }),
  ).toBeVisible();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('dialog', { name: 'Просмотр фотографий' })).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
});

test('multiline composer and history fit narrow screens and the visible keyboard viewport', async ({
  page,
}) => {
  await seed(page);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expectChatFrame(page, width >= 900 ? 774 : 844, width >= 900 ? 70 : 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const input = page.getByRole('textbox', { name: 'Текст заметки', exact: true });
  expect(
    await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  const before = (await input.boundingBox())!.height;
  await input.fill('Первая строка\nВторая строка\nТретья строка');
  expect((await input.boundingBox())!.height).toBeGreaterThan(before);
  await setVisibleViewport(page, { height: 440 });
  await expect
    .poll(() => input.evaluate((el) => el.getBoundingClientRect().bottom))
    .toBeLessThanOrEqual(440);
  await page.getByRole('button', { name: 'Отправить заметку', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(page.locator('.chat-bubble')).toHaveCount(7);
  await expect
    .poll(() =>
      page
        .locator('.chat-bubble')
        .last()
        .evaluate((el) => {
          const dock = document.querySelector('.order-chat-dock')!;
          return el.getBoundingClientRect().bottom - dock.getBoundingClientRect().top;
        }),
    )
    .toBeLessThanOrEqual(-8);
});

test('chat stays one compact frame through restored page scroll, keyboard, browser toolbar and modal changes', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('button', { name: 'Обзор', exact: true }).click();
  await page.evaluate(() => window.scrollTo({ top: 1000, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await expectChatFrame(page, 844);
  const baseline = await chatGeometry(page);
  const input = page.getByRole('textbox', { name: 'Текст заметки', exact: true });

  await input.focus();
  await setVisibleViewport(page, { height: 440, offsetTop: 24 });
  await expectChatFrame(page, 440, 24);
  await expect
    .poll(() => input.evaluate((el) => el.getBoundingClientRect().bottom))
    .toBeLessThanOrEqual(464);

  await input.evaluate((el) => el.blur());
  await setVisibleViewport(page, { height: 844 });
  await expectChatFrame(page, 844);
  await expect(input).not.toBeFocused();

  // Browser chrome also changes the visible area with no keyboard or focused input.
  await setVisibleViewport(page, { height: 780 });
  await expectChatFrame(page, 780);
  await setVisibleViewport(page, { height: 600, offsetTop: 30, scale: 1.25 });
  await expectChatFrame(page, 780);
  await setVisibleViewport(page, { height: 844 });
  await expectChatFrame(page, 844);

  await message(page, 'voice').click({ button: 'right' });
  const menu = page.getByRole('dialog', { name: 'Действия с сообщением', exact: true });
  await expect(menu).toBeVisible();
  await expectChatFrame(page, 844);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expectChatFrame(page, 844);
  const returned = await chatGeometry(page);
  expect(returned.documentScroll).toBe(baseline.documentScroll);
  expect(returned.mainScroll).toBe(baseline.mainScroll);
  expect(returned.documentHeight).toBeLessThanOrEqual(baseline.documentHeight + 2);
});

test('scrolling old messages and growing the composer preserves the reading position inside history', async ({
  page,
}) => {
  await seed(page);
  const history = page.locator('[data-chat-scroll]');
  await expect
    .poll(() => history.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThan(5);
  const initial = await chatGeometry(page);
  const box = (await history.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -600);
  await expect
    .poll(() => history.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeGreaterThan(300);
  let previousTop = -1;
  await expect
    .poll(async () => {
      const top = await history.evaluate((el) => el.scrollTop);
      const settled = Math.abs(top - previousTop) <= 1;
      previousTop = top;
      return settled;
    })
    .toBe(true);
  const readingTop = await history.evaluate((el) => el.scrollTop);
  const input = page.getByRole('textbox', { name: 'Текст заметки', exact: true });
  const before = (await input.boundingBox())!.height;
  await input.fill('Первая строка\nВторая строка\nТретья строка\nЧетвёртая строка');
  expect((await input.boundingBox())!.height).toBeGreaterThan(before);
  await expectChatFrame(page, 844);
  await expect
    .poll(async () => Math.abs((await history.evaluate((el) => el.scrollTop)) - readingTop))
    .toBeLessThanOrEqual(3);
  const after = await chatGeometry(page);
  expect(after.history.height).toBeLessThan(initial.history.height);
  expect(after.documentScroll).toBe(initial.documentScroll);
  expect(after.mainScroll).toBe(initial.mainScroll);
});

test('draft attachments remove through holding; public materials use the same bubbles', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('button', { name: 'Открыть вложения', exact: true }).click();
  const chooserWait = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Фото/видео', exact: true }).click();
  const chooser = await chooserWait;
  await chooser.setFiles({
    name: 'sample.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6nQAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  const draft = page.getByLabel('Медиавложение в черновике', { exact: true });
  await expect(draft).toBeVisible();
  await draft.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('button', { name: 'Убрать из черновика', exact: true }).click();
  await expect(draft).toHaveCount(0);
  await page.getByRole('button', { name: 'Материалы', exact: true }).click();
  await expect(page.locator('.chat-bubble')).toHaveCount(1);
  await message(page, 'proof').click({ button: 'right' });
  await page.getByRole('button', { name: 'Удалить сообщение', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Удалить сообщение?', exact: true })
    .getByRole('button', { name: 'Удалить', exact: true })
    .click();
  await expect(page.getByText('Материалов пока нет', { exact: true })).toBeVisible();
  expect(await storedIds(page)).not.toContain('proof');
});
