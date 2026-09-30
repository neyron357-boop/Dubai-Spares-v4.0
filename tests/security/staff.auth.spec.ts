import { expect, test } from '@playwright/test';

const user = { id: '12345678-1234-4123-8123-123456789abc', aud: 'authenticated', role: 'authenticated', email: 'staff@example.test', created_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const token = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url')}.qa`;

for (const member of [true, false]) {
  test(member ? 'allows a provisioned staff member and supports logout' : 'denies a signed-in user who is not a staff member', async ({ page }) => {
    await page.route('https://qa-only.supabase.co/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/auth/v1/token') return route.fulfill({ json: { access_token: token, refresh_token: 'qa-refresh', expires_in: 3600, token_type: 'bearer', user } });
      if (path === '/auth/v1/logout') return route.fulfill({ status: 204 });
      if (path === '/rest/v1/rpc/app_is_member') {
        expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
        return route.fulfill({ json: member });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto('/#/orders');
    await expect(page.getByRole('heading', { name: 'Вход для сотрудников' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Новый заказ', exact: true })).toHaveCount(0);
    await page.getByLabel('Email').fill('staff@example.test');
    await page.getByLabel('Пароль').fill('a-test-password');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    if (member) {
      await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Выйти', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Вход для сотрудников' })).toBeVisible();
    } else {
      await expect(page.getByRole('alert')).toContainText('нет доступа');
      await expect(page.getByRole('button', { name: 'Новый заказ', exact: true })).toHaveCount(0);
    }
  });
}

test('keeps the public request form available without staff login', async ({ page }) => {
  await page.route('https://qa-only.supabase.co/**', (route) => route.fulfill({ json: [] }));
  await page.goto('/#/request');
  await expect(page.getByRole('heading', { name: 'Введите данные автомобиля' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Вход для сотрудников' })).toHaveCount(0);
});
