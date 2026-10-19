import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type {} from './fixtures/legacyDriver';
import { openSvgFixture } from './fixtures/openSvgFixture';

const artifactDir = 'docs/stage-3-artifacts';
const cases = [
  { name: 'sitting-7-head', fixture: 'peep-sitting-7.svg', selectors: ['[id="Head"]'] },
  { name: 'sitting-7-pose', fixture: 'peep-sitting-7.svg', selectors: ['[id^="pose/"]'] },
  { name: 'sitting-10-head', fixture: 'peep-sitting-10.svg', selectors: ['[id="Head"]'] },
  { name: 'sitting-10-pose', fixture: 'peep-sitting-10.svg', selectors: ['[id^="pose/"]'] },
  { name: 'standing-24-head', fixture: 'peep-standing-24.svg', selectors: ['[id="Head"]'] },
  { name: 'standing-24-pose', fixture: 'peep-standing-24.svg', selectors: ['[id^="pose/"]'] },
  { name: 'standing-24-multiple', fixture: 'peep-standing-24.svg', selectors: ['[id="Head"]', '[id^="pose/"]'] },
  { name: 'gradient-mask-clip', fixture: 'dependencies.svg', selectors: ['#gradient-object'] },
  { name: 'radial-rotated', fixture: 'dependencies.svg', selectors: ['#radial-object'] },
  { name: 'css-multiple', fixture: 'dependencies.svg', selectors: ['#radial-object', '#gradient-object'] },
  { name: 'stroke-transformed', fixture: 'stroke.svg', selectors: ['#stroke-object'] },
];

for (const entry of cases) test(`изолированный SVG визуально совпадает: ${entry.name}`, async ({ page, browser }) => {
  await mkdir(artifactDir, { recursive: true });
  await openSvgFixture(page, 'legacy');
  await page.waitForFunction(() => window.svgExperiment?.root());
  const result = await page.evaluate(async entry => {
    const api = window.svgExperiment;
    await api.load(entry.fixture); api.select(entry.selectors);
    const original = api.sourceText(), sourceBefore = new XMLSerializer().serializeToString(api.root());
    const extracted = api.run();
    const sourceUnchanged = new XMLSerializer().serializeToString(api.root()) === sourceBefore;
    // Independent reference: full original document and its CSS/defs, only unrelated
    // graphics are hidden. No extraction/cloning function is reused to build it.
    const reference = new DOMParser().parseFromString(original, 'image/svg+xml').documentElement;
    const selected = entry.selectors.map(selector => reference.querySelector(selector)!);
    for (const shape of reference.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon')) {
      if (!shape.closest('defs,clipPath,mask') && !selected.some(node => node === shape || node.contains(shape))) (shape as SVGElement).style.setProperty('display', 'none', 'important');
    }
    const b = extracted.bounds;
    const scale = Math.min(2, 1800 / Math.max(b.width, b.height));
    const width = Math.ceil(b.width * scale), height = Math.ceil(b.height * scale);
    reference.setAttribute('viewBox', `${b.x} ${b.y} ${b.width} ${b.height}`);
    reference.setAttribute('width', String(b.width)); reference.setAttribute('height', String(b.height));
    const referenceSvg = new XMLSerializer().serializeToString(reference);
    async function render(svg: string) {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      try {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, width, height);
        return { data: context.getImageData(0, 0, width, height).data, png: canvas.toDataURL('image/png').split(',')[1] };
      } finally { URL.revokeObjectURL(url); }
    }
    const referencePixels = await render(referenceSvg), actual = await render(extracted.svg);
    let mismatched = 0, visible = 0, maxDelta = 0;
    for (let offset = 0; offset < actual.data.length; offset += 4) {
      if (actual.data[offset + 3] || referencePixels.data[offset + 3]) visible++;
      let delta = 0;
      // Compare premultiplied colors; RGB in transparent pixels is irrelevant.
      for (let channel = 0; channel < 3; channel++) delta = Math.max(delta, Math.abs(actual.data[offset + channel] * actual.data[offset + 3] / 255 - referencePixels.data[offset + channel] * referencePixels.data[offset + 3] / 255));
      delta = Math.max(delta, Math.abs(actual.data[offset + 3] - referencePixels.data[offset + 3]));
      maxDelta = Math.max(maxDelta, delta); if (delta > 10) mismatched++;
    }
    return { ...extracted, referenceSvg, sourceUnchanged, png: actual.png, referencePng: referencePixels.png,
      pixels: { width, height, mismatched, visible, mismatchRatio: visible ? mismatched / visible : 1, maxDelta } };
  }, entry);
  await writeFile(`${artifactDir}/${entry.name}.svg`, result.svg);
  await writeFile(`${artifactDir}/${entry.name}-reference.svg`, result.referenceSvg);
  await writeFile(`${artifactDir}/${entry.name}.png`, Buffer.from(result.png, 'base64'));
  await writeFile(`${artifactDir}/${entry.name}-reference.png`, Buffer.from(result.referencePng, 'base64'));
  const { svg: _svg, referenceSvg: _reference, png: _png, referencePng: _referencePng, ...metrics } = result;
  await writeFile(`${artifactDir}/${entry.name}.json`, JSON.stringify({ ...entry, browser: browser.version(), ...metrics }, null, 2) + '\n');
  expect(result.sourceUnchanged).toBe(true);
  expect(result.pixels.visible).toBeGreaterThan(30);
  expect(result.pixels.mismatchRatio).toBeLessThan(.005);
  // The same actual SVG is decoded in a fresh page after its source was destroyed.
  await page.goto('about:blank');
  await page.setContent('<!doctype html><html><body><img alt="Самостоятельный SVG"></body></html>');
  await page.getByRole('img').evaluate((img: HTMLImageElement, svg: string) => {
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); return img.decode();
  }, result.svg);
  expect(await page.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth > 0 && img.naturalHeight > 0)).toBe(true);
});

test('настоящий клик/Shift-клик, самостоятельное скачивание и повторные ID', async ({ page }) => {
  await mkdir(artifactDir, { recursive: true });
  await openSvgFixture(page, 'legacy');
  await page.getByRole('combobox', { name: 'Исходник:' }).selectOption('dependencies.svg');
  await expect(page.getByRole('status')).toHaveText('Выбрано объектов: 0');
  // Playwright traverses the open shadow DOM containing the SVG.
  await page.locator('#gradient-object rect').click();
  await expect(page.getByRole('status')).toContainText('Выбрано объектов: 1');
  await page.locator('#radial-object rect').click({ modifiers: ['Shift'] });
  await expect(page.getByRole('status')).toContainText('Выбрано объектов: 2');
  await page.locator('#radial-object rect').click({ modifiers: ['Shift'] });
  await expect(page.getByRole('status')).toContainText('Выбрано объектов: 1');
  await page.getByRole('button', { name: 'Извлечь выделение', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Извлечённый SVG-компонент' })).toBeVisible();
  await page.screenshot({ path: `${artifactDir}/experiment.png`, fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать результат SVG', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('extracted-component.svg');
  const combined = await page.evaluate(() => {
    const api = window.svgExperiment, first = api.run(), second = api.run();
    const holder = document.createElement('div'); document.body.append(holder);
    holder.innerHTML = first.svg + second.svg;
    const ids = [...holder.querySelectorAll('[id]')].map(node => node.id);
    const valid = new Set(ids).size === ids.length;
    const nodes = holder.querySelectorAll('svg rect');
    const localReferences = [...holder.querySelectorAll('svg')].every(svg => {
      const ownIds = new Set([...svg.querySelectorAll('[id]')].map(node => node.id));
      return [...svg.querySelectorAll('*')].every(node => [...node.attributes].every(attribute => [...attribute.value.matchAll(/url\(#([^)]+)\)/g)].every(match => ownIds.has(match[1]))));
    });
    return { valid, localReferences, fills: [...nodes].map(node => getComputedStyle(node).fill), count: ids.length };
  });
  expect(combined.valid).toBe(true); expect(combined.count).toBeGreaterThan(5);
  expect(combined.localReferences).toBe(true);
});
