import { expect, type Page } from '@playwright/test';

export async function selectVehicle(page: Page, field: string, query: string) {
  await page.getByRole('button', { name: field, exact: true }).click();
  const picker = page.getByRole('dialog', { name: `Выберите: ${field}`, exact: true });
  await picker.getByRole('combobox', { name: `Поиск: ${field}`, exact: true }).fill(query);
  await picker.getByRole('combobox').press('Enter');
  await expect(picker).toHaveCount(0);
}
