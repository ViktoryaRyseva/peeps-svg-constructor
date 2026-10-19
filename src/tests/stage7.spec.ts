import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { clickSource } from './sourceHelpers';

const artifacts = 'docs/stage-7-artifacts';
const panel = (page: Page) => page.getByRole('complementary', { name: 'Правая панель инструментов' });
const dialog = (page: Page) => page.getByRole('dialog');
const sourceXml = (page: Page) => page.getByTestId('source-canvas').locator('svg').first().evaluate(node => new XMLSerializer().serializeToString(node));
async function records(page: Page) {
  return page.evaluate(async () => { const path = '/src/services/storage.ts'; return (await import(path)).storage.list(); });
}
async function save(page: Page, name: string) {
  await panel(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(page).getByRole('img', { name: 'Превью выделенного компонента' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Имя файла' }).fill(name);
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
}
async function open(page: Page, name: string) {
  await page.getByRole('button', { name: `Открыть ${name}`, exact: true }).dblclick();
  await expect(page.getByTestId('source-canvas').locator('svg').first()).toBeAttached();
  await expect(page.getByText('Подготовка SVG…', { exact: true })).toHaveCount(0);
}
async function upload(page: Page, text: string, name: string) {
  await page.getByRole('button', { name: 'Загрузить SVG', exact: true }).click();
  await page.getByLabel('Выбрать SVG-файлы', { exact: true }).setInputFiles({ name: `${name}.svg`, mimeType: 'image/svg+xml', buffer: Buffer.from(text) });
  await dialog(page).getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByRole('textbox', { name: 'Имя файла' }).fill(name);
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
}
test.beforeAll(async () => { await mkdir(artifacts, { recursive: true }); });
test.beforeEach(async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('complementary', { name: 'Библиотеки' })).toBeVisible();
});

for (const person of [
  { name: 'sitting-7', parts: [[0], [1], [2], [3], [4], [5]], eyes: [2, 3] },
  { name: 'sitting-10', parts: [[0], [1], [2,3,4,5,6,7,8,9,10], [11], [12], [13]], eyes: [11, 12] },
  { name: 'standing-24', parts: [[0,1,2], [3,4], [5], [6], [7], [8]], eyes: [5, 6] },
]) test(`main editor: all face details, Shift and zoom for ${person.name}`, async ({ page }) => {
  await open(page, `peep-${person.name}.svg`);
  const initial = await sourceXml(page), stored = (await records(page)).sources;
  for (const indices of person.parts) {
    await clickSource(page, { indices });
    await expect(panel(page).getByText('Выбрано: 1', { exact: true })).toBeVisible();
    await clickSource(page, { indices, double: true });
    await panel(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
    const preview = await dialog(page).getByRole('img', { name: 'Превью выделенного компонента' }).getAttribute('src');
    const svg = decodeURIComponent(preview!.split(',').slice(1).join(','));
    expect(svg.match(/M/g)).toHaveLength(indices.length);
    await dialog(page).getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(panel(page).getByText('Выбрано: 1', { exact: true })).toBeVisible();
  }
  for (const zoom of [50, 200, 100]) {
    let current = Number((await page.getByRole('group', { name: 'Масштаб холста' }).innerText()).match(/\d+/)![0]);
    while (current !== zoom) {
      await page.getByRole('button', { name: current < zoom ? 'Увеличить масштаб' : 'Уменьшить масштаб', exact: true }).click();
      current += current < zoom ? 25 : -25;
    }
    await page.getByTestId('artboard-scroll').evaluate(element => { element.scrollTop = 0; element.scrollLeft = 0; });
    await clickSource(page, { indices: [person.eyes[0]], double: true });
    await clickSource(page, { indices: [person.eyes[1]], shift: true });
    await expect(panel(page).getByText('Выбрано: 2', { exact: true })).toBeVisible();
    await clickSource(page, { indices: [person.eyes[1]], shift: true });
    await expect(panel(page).getByText('Выбрано: 1', { exact: true })).toBeVisible();
  }
  expect(await sourceXml(page)).toBe(initial); expect((await records(page)).sources).toEqual(stored);
  await page.keyboard.press('Escape');
  await expect(panel(page).getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
});

test('main editor saves only the mouth; survives reload, preview and independent composition', async ({ page }) => {
  await open(page, 'peep-sitting-7.svg');
  const before = await sourceXml(page), original = (await records(page)).sources;
  await clickSource(page, { indices: [0], double: true });
  await page.screenshot({ path: `${artifacts}/source-selection.png`, fullPage: true });
  await panel(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  const preview = decodeURIComponent((await dialog(page).getByRole('img', { name: 'Превью выделенного компонента' }).getAttribute('src'))!.split(',').slice(1).join(','));
  await page.screenshot({ path: `${artifacts}/mouth-save-dialog.png`, fullPage: true });
  await page.getByRole('textbox', { name: 'Имя файла' }).fill('Рот Smile');
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  const stored = (await records(page)).components.find((value: { name: string }) => value.name === 'Рот Smile.svg')!;
  expect(stored.svgContent).toBe(preview); expect(stored.svgContent.match(/<path\b/g)).toHaveLength(1);
  const size = await page.evaluate(svg => new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.getAttribute('viewBox')!.split(' ').map(Number), stored.svgContent);
  expect(size.slice(0,2)).toEqual([0,0]); expect(size[2]).toBeLessThan(30); expect(size[3]).toBeLessThan(20);
  expect(await sourceXml(page)).toBe(before); expect((await records(page)).sources).toEqual(original);
  await expect(panel(page).getByText('Нет выделения', { exact: true })).toBeVisible();
  await writeFile(`${artifacts}/mouth.svg`, stored.svgContent);
  await page.reload();
  await page.getByRole('button', { name: 'Открыть Рот Smile.svg', exact: true }).hover();
  const thumbnail = page.getByRole('img', { name: 'Превью Рот Smile.svg', exact: true }); await expect(thumbnail).toBeVisible();
  expect(await thumbnail.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: `${artifacts}/component-library.png`, fullPage: true });
  await page.getByRole('button', { name: 'Удалить peep-sitting-7.svg', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Удалить', exact: true }).click(); await expect(dialog(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Открыть Рот Smile.svg', exact: true }).dblclick();
  await dialog(page).getByRole('button', { name: 'Да, создать', exact: true }).click();
  await expect(page.getByTestId('artboard').locator('img')).toHaveCount(1);
  expect(decodeURIComponent((await page.getByTestId('artboard').locator('img').getAttribute('src'))!.split(',').slice(1).join(','))).toBe(stored.svgContent);
  await panel(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByRole('textbox', { name: 'Имя файла' }).fill('Сцена с деталью');
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(dialog(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Удалить Рот Smile.svg', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Удалить', exact: true }).click(); await expect(dialog(page)).toHaveCount(0);
  await page.reload(); await page.getByRole('button', { name: 'Открыть Сцена с деталью.json', exact: true }).dblclick();
  expect(decodeURIComponent((await page.getByTestId('artboard').locator('img').getAttribute('src'))!.split(',').slice(1).join(','))).toBe(stored.svgContent);
});

test('cancel, duplicate name and failed write preserve the real selection and extraction snapshot', async ({ page }) => {
  await open(page, 'peep-sitting-7.svg'); await clickSource(page, { indices: [2], double: true });
  await panel(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(panel(page).getByText('Выбрано: 1', { exact: true })).toBeVisible(); expect((await records(page)).components).toHaveLength(3);
  await panel(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByRole('textbox', { name: 'Имя файла' }).fill('Сидящий персонаж');
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(dialog(page).getByRole('alert')).toContainText('Такое имя уже есть');
  await page.getByRole('textbox', { name: 'Имя файла' }).fill('Глаз после ошибки');
  const preview = await dialog(page).getByRole('img').getAttribute('src');
  await page.evaluate(() => { const add = IDBObjectStore.prototype.add; IDBObjectStore.prototype.add = function () { IDBObjectStore.prototype.add = add; throw new DOMException('Quota failure', 'QuotaExceededError'); }; });
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Недостаточно места');
  await expect(page.getByRole('textbox', { name: 'Имя файла' })).toHaveValue('Глаз после ошибки'); expect((await records(page)).components).toHaveLength(3);
  expect(await dialog(page).getByRole('img').getAttribute('src')).toBe(preview);
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(dialog(page)).toHaveCount(0);
  expect((await records(page)).components).toHaveLength(4);
});

for (const kind of ['linear','radial','clip','mask']) test(`storage and autonomous pixels preserve ${kind} on a small detail`, async ({ page }) => {
  const source = await readFile('public/experiments-v2/resources.svg', 'utf8');
  const reference = await readFile(`docs/stage-3-v2-artifacts/${kind}-1-reference.svg`, 'utf8');
  await upload(page, source, 'Ресурсы'); await open(page, 'Ресурсы.svg');
  await clickSource(page, { selector: `#${kind}-detail`, indices: [1], double: true });
  await save(page, `Деталь ${kind}`);
  const stored = (await records(page)).components.find((value: { name: string }) => value.name === `Деталь ${kind}.svg`)!;
  await page.goto('about:blank');
  const delta = await page.evaluate(async ({ svg, reference }) => {
    async function pixels(text: string) {
      const url = URL.createObjectURL(new Blob([text], {type:'image/svg+xml'}));
      try {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 240;
        const context = canvas.getContext('2d')!; context.drawImage(image,0,0,240,240); return context.getImageData(0,0,240,240).data;
      } finally {URL.revokeObjectURL(url);}
    }
    const a = await pixels(svg), b = await pixels(reference); let max = 0;
    for(let i=0;i<a.length;i++) max = Math.max(max,Math.abs(a[i]-b[i])); return max;
  }, {svg: stored.svgContent, reference});
  expect(delta).toBe(0); await writeFile(`${artifacts}/${kind}.svg`, stored.svgContent);
  await writeFile(`${artifacts}/${kind}.json`, JSON.stringify({kind,maxDelta:delta,storedBytes:stored.svgContent.length},null,2)+'\n');
});

test('unsupported source and viewport resource have clear errors without fake component records', async ({ page }) => {
  await upload(page, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><defs><path id="p" d="M0 0h20v20z"/></defs><use href="#p"/></svg>', 'Неизвестная структура');
  await page.getByRole('button', { name: 'Открыть Неизвестная структура.svg', exact: true }).dblclick();
  await expect(page.getByRole('status').filter({hasText:'Только просмотр'})).toContainText('<use>');
  await expect(page.getByRole('img',{name:'Просмотр исходника'})).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  await upload(page, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><path id="p" fill="url(#g)" d="M20 20h30v30h-30z M120 20h30v30h-30z"/></svg>', 'Процентный градиент');
  await open(page, 'Процентный градиент.svg'); await clickSource(page, { selector:'#p',indices:[0], double:true });
  await panel(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toContainText('viewport'); await expect(dialog(page)).toHaveCount(0);
  expect((await records(page)).components).toHaveLength(3);
});

test('repeated extraction isolates IDs and ten instances render with independent SVG images', async ({ page }) => {
  await upload(page, await readFile('public/experiments-v2/resources.svg', 'utf8'), 'Повторяемый градиент');
  await open(page, 'Повторяемый градиент.svg');
  for (const name of ['Градиент A', 'Градиент B']) {
    await clickSource(page, { selector: '#linear-detail', indices: [1], double: true }); await save(page, name);
  }
  const saved = (await records(page)).components.filter((value: { name: string }) => value.name.startsWith('Градиент '));
  const ids = await page.evaluate((texts: string[]) => texts.flatMap(text => [...new DOMParser().parseFromString(text, 'image/svg+xml').querySelectorAll('[id]')].map(node => node.id)), saved.map((value: {svgContent:string}) => value.svgContent));
  expect(new Set(ids).size).toBe(ids.length);
  await page.getByRole('button', { name: 'Открыть Градиент B.svg', exact: true }).dblclick();
  await dialog(page).getByRole('button', { name: 'Да, создать', exact: true }).click();
  await page.getByRole('button', { name: 'Выделить экземпляр 1: Градиент B.svg', exact: true }).click();
  for(let i=0;i<9;i++) await panel(page).getByRole('button', { name: 'Дублировать', exact: true }).click();
  const images = page.getByTestId('artboard').locator('img'); await expect(images).toHaveCount(10);
  expect(await images.evaluateAll((nodes: HTMLImageElement[]) => nodes.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  await writeFile(`${artifacts}/repeated.json`, JSON.stringify({isolatedExtractionIds:true,instances:10},null,2)+'\n');
});
