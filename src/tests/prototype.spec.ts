import { expect, test, type Page } from '@playwright/test';
import { clickSource } from './sourceHelpers';

const dialog = (page: Page) => page.getByRole('dialog');
const panel = (page: Page) => page.getByRole('complementary', { name: 'Правая панель инструментов' });
async function source(page: Page) {
  await page.getByRole('button', { name: 'Создать компонент', exact: true }).click();
  await dialog(page).getByRole('radio', { name: 'Выбрать peep-sitting-7.svg', exact: true }).check();
  await dialog(page).getByRole('button', { name: 'Открыть исходник', exact: true }).click();
}
async function compose(page: Page) {
  await page.getByRole('button', { name: 'Создать композицию', exact: true }).click();
  await dialog(page).getByRole('checkbox', { name: 'Выбрать Сидящий персонаж.svg', exact: true }).check();
  await dialog(page).getByRole('checkbox', { name: 'Выбрать Танцующий персонаж.svg', exact: true }).check();
  await page.screenshot({ path: 'docs/stage-2-picker.png' });
  await dialog(page).getByRole('button', { name: 'Создать композицию', exact: true }).click();
}
test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('пустое состояние, папки, отмена и Escape', async ({ page }) => {
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-mode', 'empty');
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Экспорт', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Увеличить масштаб' })).toBeDisabled();
  const folder = page.getByRole('button', { name: 'Исходники 3', exact: true });
  await folder.click(); await expect(folder).toHaveAttribute('aria-expanded', 'false');
  await folder.click(); await expect(folder).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ path: 'docs/stage-2-empty.png' });
  await page.getByRole('button', { name: 'Создать компонент', exact: true }).click();
  await expect(dialog(page).getByRole('button', { name: 'Открыть исходник' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-mode', 'empty');
});

test('исходник, Shift-выбор, имя, конфликт и повторное сохранение', async ({ page }) => {
  await source(page);
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  await clickSource(page, { indices: [0], double: true });
  await clickSource(page, { indices: [2], shift: true });
  await expect(panel(page).getByText('Выбрано: 2')).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Дублировать', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'docs/stage-2-source.png' });
  await panel(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByRole('textbox', { name: 'Имя файла' }).fill('Сидящий персонаж');
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Такое имя уже есть');
  await page.getByRole('textbox', { name: 'Имя файла' }).fill('Мой компонент');
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Открыть Мой компонент.svg', exact: true })).toBeVisible();
  await expect(panel(page).getByText('Нет выделения', { exact: true })).toBeVisible();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-mode', 'source');
});

test('мультивыбор композиции, экземпляры, слои и сохранение', async ({ page }) => {
  await compose(page);
  const instances = page.getByRole('button', { name: /^Выделить экземпляр/ });
  await expect(instances).toHaveCount(2);
  await instances.nth(0).click();
  await expect(panel(page).getByRole('button', { name: 'Назад', exact: true })).toBeDisabled();
  await panel(page).getByRole('button', { name: 'Вперёд', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Вперёд', exact: true })).toBeDisabled();
  await instances.nth(0).click({ modifiers: ['Shift'] });
  await expect(panel(page).getByText('Выбрано: 2')).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Назад', exact: true })).toBeDisabled();
  await panel(page).getByRole('button', { name: 'Дублировать', exact: true }).click();
  await expect(instances).toHaveCount(4);
  await panel(page).getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(instances).toHaveCount(2);
  await instances.nth(0).click();
  await page.screenshot({ path: 'docs/stage-2-composition.png' });
  await panel(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByRole('textbox', { name: 'Имя файла' }).fill('Моя сцена');
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Все изменения сохранены', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Увеличить масштаб' }).click();
  await expect(page.getByText('125%', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  await panel(page).getByRole('button', { name: 'Дублировать', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Сохранить изменения?' })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Нет, оставить черновик', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
  await panel(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Да, перезаписать', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
});

test('защита перехода: отмена, отмена имени, сохранение и отказ', async ({ page }) => {
  await source(page);
  await clickSource(page, { indices: [0], double: true });
  await page.getByRole('button', { name: 'Открыть Три характера.json', exact: true }).dblclick();
  await page.screenshot({ path: 'docs/stage-2-guard.png' });
  await dialog(page).getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(panel(page).getByText('Выбрано: 1', {exact:true})).toBeVisible();
  await page.getByRole('button', { name: 'Открыть Три характера.json', exact: true }).dblclick();
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-mode', 'source');
  await page.getByRole('button', { name: 'Открыть Три характера.json', exact: true }).dblclick();
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByRole('textbox', { name: 'Имя файла' }).fill('Из перехода');
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-mode', 'composition');
  await expect(page.getByRole('button', { name: 'Открыть Из перехода.svg', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Выделить экземпляр 1: Сидящий персонаж.svg', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Удалить', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть peep-sitting-10.svg', exact: true }).dblclick();
  await dialog(page).getByRole('button', { name: 'Не сохранять', exact: true }).click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-mode', 'source');
});

test('загрузка и реальный экспорт поверх документа', async ({ page }) => {
  await compose(page);
  await page.getByRole('button', { name: 'Загрузить SVG', exact: true }).click();
  await page.getByLabel('Выбрать SVG-файлы', { exact: true }).setInputFiles([
    { name: 'first.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20"/></svg>') },
    { name: 'second.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20"/></svg>') },
    { name: 'third.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20"/></svg>') },
    { name: 'skip.png', mimeType: 'image/png', buffer: Buffer.from('not-svg') },
  ]);
  await expect(page.getByRole('alert')).toContainText('только файлы .svg');
  await dialog(page).getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByRole('textbox', { name: 'Имя файла' }).fill('Загруженный');
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(page).getByText('second.svg', { exact: true })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Продолжить', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(dialog(page).getByText('third.svg', { exact: true })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Открыть Загруженный.svg', exact: true })).toBeVisible();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-mode', 'composition');
  await expect(page.getByText('Есть несохранённые изменения', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Подтвердить экспорт', exact: true }).click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-mode', 'composition');
  expect((await download).suggestedFilename()).toBe('Новая композиция.svg');
  await expect(page.getByText('Есть несохранённые изменения', { exact: true })).toBeVisible();
});

test('удаление компонента не ломает сцену, удаление активного файла подтверждается', async ({ page }) => {
  await page.getByRole('button', { name: 'Открыть Три характера.json', exact: true }).dblclick();
  const deleteComponent = page.getByRole('button', { name: 'Удалить Сидящий персонаж.svg', exact: true });
  await deleteComponent.focus(); await deleteComponent.click();
  await dialog(page).getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Открыть Сидящий персонаж.svg', exact: true })).toBeVisible();
  await deleteComponent.focus(); await deleteComponent.click();
  await dialog(page).getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Выделить экземпляр/ })).toHaveCount(3);
  const deleteComposition = page.getByRole('button', { name: 'Удалить Три характера.json', exact: true });
  await deleteComposition.focus(); await deleteComposition.click();
  await dialog(page).getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-mode', 'empty');
});

test('повторное открытие не сбрасывает черновик, пустую сцену нельзя экспортировать', async ({ page }) => {
  await page.getByRole('button', { name: 'Открыть Три характера.json', exact: true }).dblclick();
  const instances = page.getByRole('button', { name: /^Выделить экземпляр/ });
  await instances.nth(0).click();
  await panel(page).getByRole('button', { name: 'Дублировать', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть Три характера.json', exact: true }).dblclick();
  await expect(instances).toHaveCount(4); await expect(dialog(page)).toHaveCount(0);
  // Keyboard selection also reaches an original covered by its duplicate.
  await instances.nth(0).press('Enter');
  for (let index = 1; index < 4; index++) await instances.nth(index).press('Shift+Enter');
  await panel(page).getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Экспорт', exact: true })).toBeDisabled();
  await expect(panel(page).getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  await expect(page.getByText('Есть несохранённые изменения', { exact: true })).toBeVisible();
});

test('попап из компонента и мобильная раскладка', async ({ page }) => {
  await page.getByRole('button', { name: 'Открыть Сидящий персонаж.svg', exact: true }).dblclick();
  await dialog(page).getByRole('button', { name: 'Нет', exact: true }).click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-mode', 'empty');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Загрузить SVG', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Создать композицию', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/stage-2-mobile.png' });
  await page.getByRole('button', { name: 'Создать компонент', exact: true }).click();
  await expect(dialog(page)).toBeInViewport();
});

test('в браузере нет ошибок приложения и отсутствующих ресурсов', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const failed: string[] = [];
  page.on('response', response => { if (response.status() >= 400) failed.push(response.url()); });
  await page.reload(); await source(page);
  await page.getByRole('button', { name: 'Открыть Три характера.json', exact: true }).dblclick();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-mode', 'composition');
  expect(errors).toEqual([]); expect(failed).toEqual([]);
});
