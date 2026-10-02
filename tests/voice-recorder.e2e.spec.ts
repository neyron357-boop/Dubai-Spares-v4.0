import { expect, test, type Page } from '@playwright/test';

const orderId = '80000000-0000-4000-8000-000000000001';
test.use({
  viewport: { width: 390, height: 844 },
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});
async function seed(page: Page) {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as any).voiceTracks = [];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      (window as any).voiceTracks.push(...stream.getTracks());
      return stream;
    };
  });
  await page.goto('/#/orders');
  await expect(page.getByRole('heading', { name: 'Заказы', exact: true })).toBeVisible();
  await page.evaluate(async (id) => {
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
        clientName: 'Voice QA',
        parts: [],
        notes: [],
        status: 'in_progress',
        priority: 'medium',
        source: 'WhatsApp',
        paymentStatus: 'search_deposit_paid',
        searchDepositStatus: 'paid',
        createdAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, orderId);
  await page.goto(`/#/order/${orderId}`);
  await page.reload();
  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Записать голос', exact: true })).toBeVisible();
}
async function storedVoices(page: Page) {
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
    return (order.notes || []).flatMap((note: any) => note.audios || []);
  }, orderId);
}
async function hold(page: Page) {
  const box = (await page
    .getByRole('button', { name: 'Записать голос', exact: true })
    .boundingBox())!;
  const position = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(position.x, position.y);
  await page.mouse.down();
  await expect(page.locator('.voice-module')).toHaveAttribute('data-phase', 'recording');
  return position;
}
async function locked(page: Page) {
  const position = await hold(page);
  await page.mouse.move(position.x, position.y - 100, { steps: 8 });
  await page.mouse.up();
  await expect(
    page.getByRole('button', { name: 'Поставить запись на паузу', exact: true }),
  ).toBeVisible();
}
async function tracksStopped(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).voiceTracks.every(
          (track: MediaStreamTrack) => track.readyState === 'ended',
        ),
      ),
    )
    .toBe(true);
}

test('hold and release records real audio and saves offline', async ({ page, context }) => {
  await seed(page);
  await context.setOffline(true);
  await hold(page);
  await page.waitForTimeout(1300);
  await page.mouse.up();
  await expect(page.locator('.voice-module')).toHaveAttribute('data-phase', 'idle');
  const voices = await storedVoices(page);
  expect(voices).toHaveLength(1);
  expect(voices[0].fileUrl).toMatch(/^data:audio\/wav;base64,/);
  expect(voices[0].duration).toBeGreaterThan(1);
  expect(new Set(voices[0].waveform).size).toBeGreaterThan(1);
  await tracksStopped(page);
  await context.setOffline(false);
  await page.reload();
  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await expect(page.getByTestId('voice-message')).toHaveCount(1);
  await page.getByRole('button', { name: 'Прослушать голосовое сообщение', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Приостановить прослушивание', exact: true }),
  ).toBeVisible();
});

test('swipe left cancels; a new recording can start immediately', async ({ page }) => {
  await seed(page);
  const position = await hold(page);
  await page.waitForTimeout(700);
  await page.mouse.move(position.x - 110, position.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.voice-module')).toHaveAttribute('data-phase', 'idle');
  await tracksStopped(page);
  expect(await storedVoices(page)).toHaveLength(0);
  await locked(page);
  await page.getByRole('button', { name: 'Удалить запись', exact: true }).click();
  await tracksStopped(page);
});

test('lock, pause, play, seek, change speed and append another segment', async ({ page }) => {
  await seed(page);
  await locked(page);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Заметки', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Поставить запись на паузу', exact: true }).click();
  await expect(page.locator('.voice-module')).toHaveAttribute('data-phase', 'paused');
  await tracksStopped(page);
  const audio = page.locator('.voice-recorder audio');
  await page.getByRole('button', { name: 'Прослушать голосовое сообщение', exact: true }).click();
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(false);
  const range = page.getByRole('slider', { name: 'Позиция голосового сообщения' });
  await range.fill('0.8');
  await range.dispatchEvent('input');
  await page.getByRole('button', { name: 'Скорость воспроизведения 1×' }).click();
  expect(await audio.evaluate((el: HTMLAudioElement) => el.playbackRate)).toBe(1.5);
  await page.getByRole('button', { name: 'Продолжить запись', exact: true }).click();
  await expect(page.locator('.voice-module')).toHaveAttribute('data-phase', 'recording');
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: 'Поставить запись на паузу', exact: true }).click();
  await expect(page.locator('.voice-module')).toHaveAttribute('data-phase', 'paused');
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Отправить голосовое сообщение', exact: true }).click();
  await expect(page.locator('.voice-module')).toHaveAttribute('data-phase', 'idle');
  const voices = await storedVoices(page);
  expect(voices).toHaveLength(1);
  expect(voices[0].duration).toBeGreaterThan(2.1);
  expect(voices[0].duration).toBeLessThan(4);
  await tracksStopped(page);
});

test('denied permission is visible; late microphone resolution is stopped', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    (window as any).originalVoiceGet = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Denied', 'NotAllowedError'));
  });
  await page.getByRole('button', { name: 'Записать голос', exact: true }).press('Enter');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Нет доступа к микрофону' }),
  ).toBeVisible();
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await (window as any).originalVoiceGet(constraints);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return stream;
    };
  });
  const box = (await page
    .getByRole('button', { name: 'Записать голос', exact: true })
    .boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await expect(page.locator('.voice-module')).toHaveAttribute('data-phase', 'requesting');
  await page.mouse.up();
  await expect(page.locator('.voice-module')).toHaveAttribute('data-phase', 'idle');
  await page.waitForTimeout(1500);
  await tracksStopped(page);
  expect(await storedVoices(page)).toHaveLength(0);
});

test('failed local save keeps preview; retry saves only once', async ({ page }) => {
  await seed(page);
  await locked(page);
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Поставить запись на паузу', exact: true }).click();
  await expect(page.locator('.voice-module')).toHaveAttribute('data-phase', 'paused');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).voiceFailSave = true;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'orders' && (window as any).voiceFailSave)
        throw new DOMException('Full', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Отправить голосовое сообщение', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Запись сохранена в этом окне' }),
  ).toBeVisible();
  await expect(page.locator('.voice-recorder').getByTestId('voice-message')).toBeVisible();
  expect(await storedVoices(page)).toHaveLength(0);
  await page.evaluate(() => {
    (window as any).voiceFailSave = false;
  });
  await page.getByRole('button', { name: 'Отправить голосовое сообщение', exact: true }).click();
  await expect(page.locator('.voice-module')).toHaveAttribute('data-phase', 'idle');
  expect(await storedVoices(page)).toHaveLength(1);
});

test('short tap hints, keyboard recording and Escape release microphone', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Записать голос', exact: true }).click();
  await expect(
    page.getByText('Удерживайте для записи · вверх — закрепить · влево — отменить', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Записать голос', exact: true }).press('Enter');
  await expect(page.locator('.voice-module')).toHaveAttribute('data-phase', 'recording');
  await expect(
    page.getByRole('button', { name: 'Поставить запись на паузу', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await tracksStopped(page);
  expect(await storedVoices(page)).toHaveLength(0);
});

test('native mobile touch locks and cancels without text selection or page scroll', async ({
  page,
  context,
}) => {
  await seed(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const box = (await page
    .getByRole('button', { name: 'Записать голос', exact: true })
    .boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await expect(page.locator('.voice-module')).toHaveAttribute('data-phase', 'recording');
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: y - 100 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(
    page.getByRole('button', { name: 'Поставить запись на паузу', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await page.getByRole('button', { name: 'Удалить запись', exact: true }).click();
  await tracksStopped(page);
  expect(await storedVoices(page)).toHaveLength(0);
});

test('materials share the recorder and store voice in the proof collection', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Материалы', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Записать голос', exact: true })).toBeVisible();
  await locked(page);
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Отправить голосовое сообщение', exact: true }).click();
  await expect(page.locator('.voice-module')).toHaveAttribute('data-phase', 'idle');
  const voices = await storedVoices(page);
  expect(voices).toHaveLength(1);
  await expect(page.getByTestId('voice-message')).toHaveCount(1);
  await tracksStopped(page);
});

test('closing message actions with Escape preserves the paused recording', async ({ page }) => {
  await seed(page);
  const text = page.getByRole('textbox', { name: 'Текст заметки', exact: true });
  await text.fill('Предыдущее сообщение');
  await page.getByRole('button', { name: 'Отправить заметку', exact: true }).click();
  await expect(text).toHaveValue('');
  await locked(page);
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Поставить запись на паузу', exact: true }).click();
  await expect(page.locator('.voice-module')).toHaveAttribute('data-phase', 'paused');
  await page.locator('.chat-bubble').click({ button: 'right' });
  await expect(
    page.getByRole('dialog', { name: 'Действия с сообщением', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.voice-module')).toHaveAttribute('data-phase', 'paused');
  await expect(page.locator('.voice-recorder').getByTestId('voice-message')).toBeVisible();
  await page.getByRole('button', { name: 'Удалить запись', exact: true }).click();
  await tracksStopped(page);
});
