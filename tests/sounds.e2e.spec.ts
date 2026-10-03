import { expect, test, type Page } from '@playwright/test';

const settingsKey = 'dubai_spares_app_settings_v1';
const labels = ['Нажатие', 'Переход', 'Готово', 'Внимание', 'Уведомление', 'Удаление'];
const voiceOrderId = '89000000-0000-4000-8000-000000000001';

test.use({ viewport: { width: 390, height: 844 } });

type SoundProbe = {
  contexts: number;
  starts: Array<{ duration: number; peak: number; finite: boolean }>;
  stops: number;
};
async function instrument(page: Page, enabled = false) {
  await page.addInitScript(
    ({ key, enabled }) => {
      if (!localStorage.getItem(key) && enabled)
        localStorage.setItem(key, JSON.stringify({ soundsEnabled: true, soundVolume: 55 }));
      const probe: SoundProbe = { contexts: 0, starts: [], stops: 0 };
      (window as typeof window & { soundProbe: SoundProbe }).soundProbe = probe;
      const NativeContext = window.AudioContext;
      if (!NativeContext) return;
      class ObservedContext extends NativeContext {
        constructor(options?: AudioContextOptions) {
          super(options);
          probe.contexts += 1;
        }
        createBufferSource() {
          const source = super.createBufferSource();
          const nativeStart = source.start.bind(source);
          const nativeStop = source.stop.bind(source);
          source.start = (...args) => {
            const samples = source.buffer?.getChannelData(0) || [];
            let peak = 0;
            let finite = true;
            for (const sample of samples) {
              peak = Math.max(peak, Math.abs(sample));
              finite &&= Number.isFinite(sample);
            }
            probe.starts.push({ duration: source.buffer?.duration || 0, peak, finite });
            nativeStart(...args);
          };
          source.stop = (...args) => {
            probe.stops += 1;
            nativeStop(...args);
          };
          return source;
        }
      }
      window.AudioContext = ObservedContext;
    },
    { key: settingsKey, enabled },
  );
}
async function probe(page: Page): Promise<SoundProbe> {
  return page.evaluate(() => (window as typeof window & { soundProbe: SoundProbe }).soundProbe);
}
async function openSettings(page: Page) {
  await page.goto('/#/settings');
  await expect(page.getByRole('switch', { name: 'Звуки интерфейса', exact: true })).toBeVisible();
}
async function previewsDisabled(page: Page) {
  for (const label of labels)
    await expect(
      page.getByRole('button', { name: `Прослушать: ${label}`, exact: true }),
    ).toBeDisabled();
}
async function preview(page: Page, label: string) {
  const button = page.getByRole('button', { name: `Прослушать: ${label}`, exact: true });
  const before = (await probe(page)).starts.length;
  await button.click();
  await expect.poll(async () => (await probe(page)).starts.length).toBe(before + 1);
  await expect(button).toHaveAttribute('aria-busy', 'false');
}
async function savedPreferences(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), settingsKey);
}
async function seedVoiceOrder(page: Page) {
  await page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dubai-spares-offline');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('orders', 'readwrite');
      transaction.objectStore('orders').put({
        id,
        brand: 'BMW',
        model: '3 Series',
        year: '2017',
        clientName: 'Sound recording QA',
        parts: [],
        notes: [],
        status: 'active',
        priority: 'medium',
        source: 'WhatsApp',
        paymentStatus: 'search_deposit_paid',
        searchDepositStatus: 'paid',
        createdAt: Date.now(),
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, voiceOrderId);
}

test('six offline effects are opt-in, preview independently, and keep their preferences after reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await instrument(page);
  await openSettings(page);
  const toggle = page.getByRole('switch', { name: 'Звуки интерфейса', exact: true });
  await expect(toggle).not.toBeChecked();
  await previewsDisabled(page);
  expect((await probe(page)).contexts).toBe(0);
  await toggle.check();
  await expect.poll(async () => (await savedPreferences(page)).soundsEnabled).toBe(true);
  const before = (await probe(page)).starts.length;
  for (const label of labels) await preview(page, label);
  const played = (await probe(page)).starts.slice(before);
  expect(played).toHaveLength(6);
  expect(new Set(played.map((sound) => sound.duration)).size).toBe(6);
  expect(played.every((sound) => sound.finite && sound.peak > 0 && sound.peak <= 0.4)).toBe(true);
  const volume = page.getByRole('slider', { name: 'Громкость звуков', exact: true });
  await volume.fill('37');
  await volume.blur();
  await expect.poll(async () => (await savedPreferences(page)).soundVolume).toBe(37);
  await page.reload();
  await expect(toggle).toBeChecked();
  await expect(volume).toHaveValue('37');
  await page.setViewportSize({ width: 320, height: 700 });
  const panel = page.getByRole('region', { name: 'Звук', exact: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  for (const label of labels) {
    const bounds = await panel
      .getByRole('button', { name: `Прослушать: ${label}`, exact: true })
      .boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
  }
  await toggle.uncheck();
  await previewsDisabled(page);
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await previewsDisabled(page);
  expect(errors).toEqual([]);
});

test('zero volume mutes effects immediately and failed preference writes keep a recoverable draft', async ({
  page,
}) => {
  await instrument(page, true);
  await openSettings(page);
  await preview(page, 'Уведомление');
  const volume = page.getByRole('slider', { name: 'Громкость звуков', exact: true });
  await volume.fill('0');
  await volume.blur();
  await previewsDisabled(page);
  await expect.poll(async () => (await savedPreferences(page)).soundVolume).toBe(0);
  const mutedCount = (await probe(page)).starts.length;
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('app-toast', { detail: { message: 'Silent confirmation', tone: 'success' } }),
    ),
  );
  await page.waitForTimeout(100);
  expect((await probe(page)).starts).toHaveLength(mutedCount);
  await page.reload();
  await expect(volume).toHaveValue('0');
  await previewsDisabled(page);
  await page.evaluate((key) => {
    const nativeSetItem = Storage.prototype.setItem;
    (window as typeof window & { rejectSoundPreferences: boolean }).rejectSoundPreferences = true;
    Storage.prototype.setItem = function (storageKey, value) {
      if (
        storageKey === key &&
        (window as typeof window & { rejectSoundPreferences: boolean }).rejectSoundPreferences
      )
        throw new DOMException('Full', 'QuotaExceededError');
      nativeSetItem.call(this, storageKey, value);
    };
  }, settingsKey);
  await volume.fill('73');
  await volume.blur();
  const error = page.getByRole('alert').filter({ hasText: 'Не удалось сохранить настройки звука' });
  await expect(error).toBeVisible();
  await expect(volume).toHaveValue('73');
  expect((await savedPreferences(page)).soundVolume).toBe(0);
  await page.getByRole('button', { name: 'Прослушать: Готово', exact: true }).click();
  expect((await probe(page)).starts).toHaveLength(0);
  await page.evaluate(() => {
    (window as typeof window & { rejectSoundPreferences: boolean }).rejectSoundPreferences = false;
  });
  await page.getByRole('button', { name: 'Повторить сохранение', exact: true }).click();
  await expect(error).toHaveCount(0);
  await expect.poll(async () => (await savedPreferences(page)).soundVolume).toBe(73);
  await preview(page, 'Готово');
});

test('missing audio support shows a local notice and leaves the rest of the app usable', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await instrument(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined });
  });
  await openSettings(page);
  await page.getByRole('switch', { name: 'Звуки интерфейса', exact: true }).check();
  await page.getByRole('button', { name: 'Прослушать: Готово', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Не удалось воспроизвести звук' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Заказы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Заказы', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('navigation sounds only real route changes and public pages stay quiet with saved opt-in', async ({
  page,
}) => {
  await instrument(page, true);
  await page.goto('/#/orders');
  await expect(page.getByRole('heading', { name: 'Заказы', exact: true })).toBeVisible();
  const current = page.getByRole('link', { name: 'Заказы', exact: true });
  await current.click();
  await page.waitForTimeout(100);
  expect((await probe(page)).starts).toHaveLength(0);
  await page.getByRole('link', { name: 'Поставщики', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Поставщики', exact: true })).toBeVisible();
  expect((await probe(page)).starts).toHaveLength(1);
  await page.evaluate(() => {
    window.location.hash = '#/request';
  });
  await expect(
    page.getByRole('heading', { name: 'Найдём нужные детали для вашего авто', exact: true }),
  ).toBeVisible();
  const count = (await probe(page)).starts.length;
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('app-toast', { detail: { message: 'Public page', tone: 'success' } }),
    ),
  );
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await page.waitForTimeout(150);
  expect((await probe(page)).starts).toHaveLength(count);
  expect((await savedPreferences(page)).soundsEnabled).toBe(true);
});

test('real media playback suppresses interface cues without changing media volume', async ({
  page,
}) => {
  await instrument(page, true);
  await openSettings(page);
  await preview(page, 'Нажатие');
  await page.evaluate(async () => {
    const rate = 8000;
    const bytes = new Uint8Array(44 + rate * 2 * 2);
    const view = new DataView(bytes.buffer);
    const text = (offset: number, value: string) =>
      Array.from(value).forEach(
        (character, index) => (bytes[offset + index] = character.charCodeAt(0)),
      );
    text(0, 'RIFF');
    view.setUint32(4, bytes.length - 8, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, bytes.length - 44, true);
    const media = document.createElement('audio');
    media.id = 'sound-test-media';
    media.src = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    media.loop = true;
    media.volume = 0.21;
    document.body.append(media);
    await media.play();
  });
  const count = (await probe(page)).starts.length;
  await page.getByRole('button', { name: 'Прослушать: Готово', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'после завершения записи или воспроизведения' }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('app-toast', { detail: { message: 'Media is playing', tone: 'error' } }),
    ),
  );
  await page.waitForTimeout(100);
  expect((await probe(page)).starts).toHaveLength(count);
  expect(
    await page.locator('#sound-test-media').evaluate((audio: HTMLAudioElement) => audio.volume),
  ).toBeCloseTo(0.21, 6);
  await page.locator('#sound-test-media').evaluate((audio: HTMLAudioElement) => audio.pause());
  await preview(page, 'Готово');
});

test('pending microphone access holds UI sounds and an aborted recording releases the hold', async ({
  page,
}) => {
  await instrument(page, true);
  await page.goto('/#/orders');
  await expect(page.getByRole('heading', { name: 'Заказы', exact: true })).toBeVisible();
  await seedVoiceOrder(page);
  await page.goto(`/#/order/${voiceOrderId}`);
  await page.reload();
  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise<MediaStream>(() => {});
  });
  const microphone = page.getByRole('button', { name: 'Записать голос', exact: true });
  const bounds = (await microphone.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await expect(page.locator('.voice-module')).toHaveAttribute('data-phase', 'requesting');
  const count = (await probe(page)).starts.length;
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('app-toast', { detail: { message: 'Recording request', tone: 'error' } }),
    ),
  );
  await page.waitForTimeout(100);
  expect((await probe(page)).starts).toHaveLength(count);
  await page.mouse.up();
  await expect(page.locator('.voice-module')).toHaveAttribute('data-phase', 'idle');
  await page.evaluate(() => {
    window.location.hash = '#/settings';
  });
  await expect(page.getByRole('switch', { name: 'Звуки интерфейса', exact: true })).toBeVisible();
  await preview(page, 'Готово');
});
