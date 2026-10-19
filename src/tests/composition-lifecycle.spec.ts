import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { clickSource } from './sourceHelpers';

const folder = 'test-artifacts/composition-lifecycle';
const dialog = (page: Page) => page.getByRole('dialog');
const panel = (page: Page) => page.getByRole('complementary', { name: 'Правая панель инструментов' });
const instances = (page: Page) => page.getByRole('button', { name: /^Выделить экземпляр/ });
async function field(page: Page, name: string, value: number) {
  const input = panel(page).getByRole('spinbutton', { name, exact: true });
  await input.fill(String(value)); await input.press('Enter');
}
const state = (page: Page) => page.evaluate(async () => {
  const path = '/src/store/editor.ts'; return (await import(path)).useEditorStore.getState().doc;
});
const library = (page: Page) => page.evaluate(async () => {
  const path = '/src/services/storage.ts'; return (await import(path)).storage.list();
});
async function save(page: Page, name?: string) {
  await panel(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  if (name) {
    await page.getByRole('textbox', { name: 'Имя файла' }).fill(name);
    await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  } else await dialog(page).getByRole('button', { name: 'Да, перезаписать', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
}
async function download(page: Page, filename: string) {
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  const pending = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Подтвердить экспорт', exact: true }).click();
  const file = await pending; expect(file.suggestedFilename()).toBe(filename);
  const target = `${folder}/${filename}`; await file.saveAs(target); return target;
}
test.beforeAll(async () => { await mkdir(folder, { recursive: true }); });

test('three extracted sources: save, exact reopen, edit, overwrite and standalone vector download', async ({ page, context }) => {
  await page.goto('/');
  for (const [source, eye, name] of [['sitting-7', 2, 'Глаз 7'], ['sitting-10', 11, 'Глаз 10'], ['standing-24', 5, 'Глаз 24']] as const) {
    await page.getByRole('button', { name: `Открыть peep-${source}.svg`, exact: true }).dblclick();
    await clickSource(page, { indices: [eye], double: true }); await save(page, name);
  }
  await page.getByRole('button', { name: 'Создать композицию', exact: true }).click();
  for (const name of ['Глаз 24.svg', 'Глаз 7.svg', 'Глаз 10.svg']) await dialog(page).getByRole('checkbox', { name: `Выбрать ${name}`, exact: true }).check();
  await dialog(page).getByRole('button', { name: 'Создать композицию', exact: true }).click();
  await instances(page).nth(0).press('Enter');
  for (const [key, value] of [['X', 177.123456789], ['Y', 88.987654321], ['Ширина', 85], ['Высота', 35], ['Поворот', 37]] as const) await field(page, key, value);
  await panel(page).getByRole('button', { name: 'Вперёд', exact: true }).click();
  const before = await state(page); await save(page, 'Три детали');
  await page.reload(); await page.getByRole('button', { name: 'Открыть Три детали.json', exact: true }).dblclick();
  const reopened = await state(page);
  expect(reopened.items).toEqual(before.items);
  await instances(page).nth(1).press('Enter'); await field(page, 'Поворот', -123.5); await save(page);
  const clean = await state(page), records = await library(page);
  const target = await download(page, 'Три детали.svg');
  expect(await state(page)).toEqual(clean); expect(await library(page)).toEqual(records);
  await expect(page.getByText('Все изменения сохранены', { exact: true })).toBeVisible();
  const svg = await readFile(target, 'utf8');
  expect(svg).not.toMatch(/<(?:image|foreignObject|script)\b|data:image|blob:/);
  const standalone = await context.newPage(); await standalone.goto(pathToFileURL(resolve(target)).href);
  const structure = await standalone.evaluate(() => {
    const root = document.documentElement;
    return { namespace: root.namespaceURI, width: root.getAttribute('width'), height: root.getAttribute('height'), viewBox: root.getAttribute('viewBox'), layers: root.children.length, paths: root.querySelectorAll('path').length, error: !!document.querySelector('parsererror') };
  });
  expect(structure).toEqual({ namespace: 'http://www.w3.org/2000/svg', width: '1200', height: '800', viewBox: '0 0 1200 800', layers: 3, paths: 3, error: false });
  await standalone.screenshot({ path: `${folder}/standalone.png` });
  await writeFile(`${folder}/reopened-project.json`, JSON.stringify(records.compositions.find((record: { name: string }) => record.name === 'Три детали.json'), null, 2));
});

test('export cancel and success preserve unsaved edits, selection, zoom and library', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Открыть Три характера.json', exact: true }).dblclick();
  await instances(page).nth(0).click(); await field(page, 'X', -20.25);
  await page.getByRole('button', { name: 'Увеличить масштаб', exact: true }).click();
  const before = await state(page), records = await library(page);
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Отмена', exact: true }).click();
  expect(await state(page)).toEqual(before);
  await download(page, 'Три характера.svg');
  expect(await state(page)).toEqual(before); expect(await library(page)).toEqual(records);
  await expect(page.getByText('Есть несохранённые изменения', { exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Масштаб холста' })).toContainText('125%');
  await expect(panel(page).getByText('Выбрано: 1', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Peeps — главная' }).click();
  await expect(dialog(page).getByRole('button', { name: 'Не сохранять', exact: true })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Отмена', exact: true }).click();
  expect(await state(page)).toEqual(before);
});

test('unsaved composition exports without creating a library project', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Создать композицию', exact: true }).click();
  await dialog(page).getByRole('checkbox').first().check();
  await dialog(page).getByRole('button', { name: 'Создать композицию', exact: true }).click();
  const before = await state(page), records = await library(page);
  await download(page, 'Новая композиция.svg');
  expect(await state(page)).toEqual(before); expect(await library(page)).toEqual(records);
});

test('failed export keeps dialog and draft with no leaked SVG mounts', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Открыть Три характера.json', exact: true }).dblclick();
  await page.evaluate(async () => {
    const path = '/src/store/editor.ts', store = (await import(path)).useEditorStore;
    const doc = store.getState().doc;
    store.getState().setDoc({ ...doc, items: doc.items.map((item: object, index: number) => index ? item : { ...item, svgContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><use href="#missing"/></svg>' }) });
  });
  const before = await state(page), count = await page.locator('body > div').count();
  let downloads = 0; page.on('download', () => downloads++);
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  for (let attempt = 0; attempt < 2; attempt++) {
    await dialog(page).getByRole('button', { name: 'Подтвердить экспорт', exact: true }).click();
    await expect(dialog(page).getByRole('alert')).toContainText('Не удалось экспортировать');
  }
  expect(downloads).toBe(0); expect(await state(page)).toEqual(before);
  expect(await page.locator('body > div').count()).toBe(count);
  await dialog(page).getByRole('button', { name: 'Отмена', exact: true }).click();
});

test('two tabs: stale overwrite is rejected, and save copy preserves both versions', async ({ page, context }) => {
  await page.goto('/'); const other = await context.newPage(); await other.goto('/');
  for (const tab of [page, other]) {
    await tab.getByRole('button', { name: 'Открыть Три характера.json', exact: true }).dblclick();
    await instances(tab).first().press('Enter');
  }
  await field(page, 'X', 111); await save(page);
  await field(other, 'Y', 222);
  const draft = await state(other);
  await panel(other).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await dialog(other).getByRole('button', { name: 'Да, перезаписать', exact: true }).click();
  await expect(dialog(other).getByRole('alert')).toContainText('другой вкладке');
  expect(await state(other)).toEqual(draft);
  let records = await library(other);
  expect(records.compositions[0].instances[0].x).toBe(111);
  await dialog(other).getByRole('button', { name: 'Сохранить копию', exact: true }).click();
  await other.getByRole('textbox', { name: 'Имя файла' }).fill('Моя версия');
  await dialog(other).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(other)).toHaveCount(0);
  records = await library(other);
  expect(records.compositions).toHaveLength(2);
  expect(records.compositions.find((record: { name: string }) => record.name === 'Три характера.json').instances[0].x).toBe(111);
  expect(records.compositions.find((record: { name: string }) => record.name === 'Моя версия.json').instances[0].y).toBe(222);
  await field(other, 'X', 333); await save(other); // new revision belongs to the copy
});

test('saved overwrite through a guard completes transition only after persistence', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Открыть Три характера.json', exact: true }).dblclick();
  await instances(page).first().press('Enter'); await field(page, 'Поворот', 73);
  await page.getByRole('link', { name: 'Peeps — главная' }).click();
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-mode', 'empty');
  await page.getByRole('button', { name: 'Открыть Три характера.json', exact: true }).dblclick();
  expect((await state(page)).items[0].rotation).toBe(73);
});
