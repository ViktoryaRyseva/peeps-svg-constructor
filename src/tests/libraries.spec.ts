import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { clickSource } from './sourceHelpers';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30"><rect width="40" height="30" fill="#e82a42"/></svg>';
const dialog = (page: Page) => page.getByRole('dialog');
async function choose(page: Page, files = [{ name: 'real.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) }]) {
  await page.getByRole('button', { name: 'Загрузить SVG', exact: true }).click();
  await page.getByLabel('Выбрать SVG-файлы', { exact: true }).setInputFiles(files);
}
async function nameFile(page: Page, name: string) {
  await dialog(page).getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByRole('textbox', { name: 'Имя файла' }).fill(name);
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Имя файла' })).toHaveCount(0);
}
test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.getByRole('complementary', { name: 'Библиотеки' })).toBeVisible(); });

test('multiple SVGs: validation, exact bytes, preview and reload', async ({ page }) => {
  await choose(page, [
    { name: 'red.SVG', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) },
    { name: 'blue.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg.replace('#e82a42', '#1246de')) },
    { name: 'wrong.png', mimeType: 'image/png', buffer: Buffer.from(svg) },
    { name: 'broken.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg><g></svg>') },
  ]);
  await expect(page.getByRole('alert')).toContainText('wrong.png');
  await expect(page.getByRole('alert')).toContainText('broken.svg');
  await nameFile(page, 'Красный.svg'); await nameFile(page, 'Синий');
  await page.reload();
  const file = page.getByRole('button', { name: 'Открыть Красный.svg', exact: true });
  await expect(file).toBeVisible(); await file.hover();
  const preview = page.getByRole('img', { name: 'Превью Красный.svg', exact: true });
  await expect(preview).toBeVisible();
  expect(decodeURIComponent((await preview.getAttribute('src'))!.split(',').slice(1).join(','))).toBe(svg);
  await expect(page.getByRole('button', { name: 'Открыть Синий.svg', exact: true })).toBeVisible();
  await file.dblclick();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-mode', 'source');
  const saved = await page.evaluate(async () => {
    const modulePath = '/src/services/storage.ts'; const { storage } = await import(modulePath);
    return (await storage.list()).sources.find((item: { name: string }) => item.name === 'Красный.svg');
  });
  expect(saved.svgContent).toBe(svg);
  await mkdir('docs/stage-6-artifacts', { recursive: true });
  await page.screenshot({ path: 'docs/stage-6-artifacts/real-upload.png' });
});

test('cancel upload and file name do not write data; case duplicate stays editable', async ({ page }) => {
  await choose(page); await dialog(page).getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.reload(); await expect(page.getByRole('button', { name: 'Исходники 3', exact: true })).toBeVisible();
  await choose(page); await dialog(page).getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByRole('textbox', { name: 'Имя файла' }).fill('Не сохранять');
  await dialog(page).getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.reload(); await expect(page.getByRole('button', { name: 'Исходники 3', exact: true })).toBeVisible();
  await choose(page); await nameFile(page, 'Café');
  await choose(page); await dialog(page).getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByRole('textbox', { name: 'Имя файла' }).fill(' CAFE\u0301.SVG ');
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Такое имя уже есть');
  await expect(page.getByRole('textbox', { name: 'Имя файла' })).toHaveValue(' CAFE\u0301.SVG ');
  await dialog(page).getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.reload(); await expect(page.getByRole('button', { name: 'Исходники 4', exact: true })).toBeVisible();
});

test('deletion persists for all libraries and does not reseed on reload', async ({ page }) => {
  for (const name of ['peep-sitting-7.svg', 'Сидящий персонаж.svg', 'Три характера.json']) {
    const remove = page.getByRole('button', { name: `Удалить ${name}`, exact: true });
    await remove.focus(); await remove.click();
    await dialog(page).getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(page.getByRole('button', { name: `Открыть ${name}`, exact: true })).toBeVisible();
    await remove.focus(); await remove.click(); await dialog(page).getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
  }
  await page.reload(); await expect(page.getByRole('button', { name: 'Исходники 2', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Компоненты 2', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Композиции 0', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть peep-sitting-7.svg', exact: true })).toHaveCount(0);
});

test('component and composition persist, deleting component preserves inline instances', async ({ page }) => {
  await page.getByRole('button', { name: 'Открыть peep-sitting-7.svg', exact: true }).dblclick();
  await clickSource(page, { indices: [0], double: true });
  await page.getByRole('complementary', { name: 'Правая панель инструментов' }).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(page)).toContainText('только выделение');
  await page.getByRole('textbox', { name: 'Имя файла' }).fill('Сохранённый компонент');
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0); await page.reload();
  await page.getByRole('button', { name: 'Открыть Сохранённый компонент.svg', exact: true }).dblclick();
  await dialog(page).getByRole('button', { name: 'Да, создать', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Правая панель инструментов' });
  await panel.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByRole('textbox', { name: 'Имя файла' }).fill('Автономная сцена');
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  const remove = page.getByRole('button', { name: 'Удалить Сохранённый компонент.svg', exact: true }); await remove.focus(); await remove.click();
  await dialog(page).getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0); await page.reload();
  await page.getByRole('button', { name: 'Открыть Автономная сцена.json', exact: true }).dblclick();
  await expect(page.getByTestId('artboard').getByRole('button', { name: /^Выделить экземпляр/ })).toHaveCount(1);
  expect(await page.getByTestId('artboard').locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const record = await page.evaluate(async () => {
    const modulePath = '/src/services/storage.ts'; const { storage } = await import(modulePath);
    return (await storage.list()).compositions.find((item: { name: string }) => item.name === 'Автономная сцена.json');
  });
  expect(record.schemaVersion).toBe(1); expect(record.instances[0].svgContent).toContain('<svg');
  expect(record.instances[0].scaleX).toBe(1); expect(record).not.toHaveProperty('zoom'); expect(record).not.toHaveProperty('selected');
});

test('write failure keeps the dialog, entered name and document; retry succeeds', async ({ page }) => {
  await page.getByRole('button', { name: 'Открыть peep-sitting-7.svg', exact: true }).dblclick();
  await choose(page); await dialog(page).getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByRole('textbox', { name: 'Имя файла' }).fill('После ошибки');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function () { IDBObjectStore.prototype.add = original; throw new DOMException('Test quota failure', 'QuotaExceededError'); };
  });
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Недостаточно места');
  await expect(page.getByRole('textbox', { name: 'Имя файла' })).toHaveValue('После ошибки');
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-mode', 'source');
  await expect(page.getByRole('button', { name: 'Исходники 3', exact: true })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0); await page.reload();
  await expect(page.getByRole('button', { name: 'Открыть После ошибки.svg', exact: true })).toBeVisible();
});

test('delete failure keeps the library record and confirmation', async ({ page }) => {
  const remove = page.getByRole('button', { name: 'Удалить peep-sitting-7.svg', exact: true }); await remove.focus(); await remove.click();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function () { IDBObjectStore.prototype.delete = original; throw new DOMException('Test unavailable store', 'InvalidStateError'); };
  });
  await dialog(page).getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('хранилище недоступно');
  await expect(page.getByRole('button', { name: 'Открыть peep-sitting-7.svg', exact: true })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0); await page.reload();
  await expect(page.getByRole('button', { name: 'Открыть peep-sitting-7.svg', exact: true })).toHaveCount(0);
});

test('scrollable lists and hover previews for actual saved records', async ({ page }) => {
  await page.evaluate(async svg => {
    const modulePath = '/src/services/storage.ts'; const { storage } = await import(modulePath);
    await Promise.all(Array.from({ length: 15 }, (_, index) => storage.addAsset('sources', `Проверка ${index}`, svg)));
  }, svg);
  await page.reload();
  const files = page.getByRole('group', { name: 'Файлы: Исходники', exact: true });
  await expect(files.getByRole('button', { name: /^Открыть / })).toHaveCount(18);
  expect(await files.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.getByRole('button', { name: 'Открыть Проверка 14.svg', exact: true }).hover();
  await expect(page.getByRole('img', { name: 'Превью Проверка 14.svg', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Открыть Три характера.json', exact: true }).hover();
  await expect(page.getByRole('img', { name: 'Превью Три характера.json', exact: true })).toBeVisible();
  await mkdir('docs/stage-6-artifacts', { recursive: true });
  await page.screenshot({ path: 'docs/stage-6-artifacts/libraries-preview.png' });
});

test('unavailable IndexedDB shows an error instead of temporary libraries, then recovers', async ({ page }) => {
  await page.evaluate(() => sessionStorage.setItem('test-block-idb', 'yes'));
  await page.addInitScript(() => {
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name: string, version?: number) {
      if (sessionStorage.getItem('test-block-idb')) throw new DOMException('Blocked by test', 'SecurityError');
      return version === undefined ? original.call(this, name) : original.call(this, name, version);
    };
  });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('доступ к локальному хранилищу');
  await expect(page.getByRole('complementary', { name: 'Библиотеки' })).toHaveCount(0);
  await page.evaluate(() => sessionStorage.removeItem('test-block-idb'));
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Исходники 3', exact: true })).toBeVisible();
});
