// Diagnostic audit only. Observed defects are not asserted as acceptable behavior.
// All browser data is created in fresh contexts, separate from the user's browser.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const folder = 'docs/stages-11-12-audit-artifacts';
const origin = process.env.AUDIT_ORIGIN ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'chrome' });
await mkdir(folder, { recursive: true });
const report = { at: new Date().toISOString(), browser: browser.version(), cases: {} };
const panel = page => page.getByRole('complementary', { name: 'Правая панель инструментов' });
const instance = page => page.getByRole('button', { name: /^Выделить экземпляр/ }).first();
async function open(page) {
  await page.goto(origin); await page.getByRole('complementary', { name: 'Библиотеки' }).waitFor();
}
async function scene(page) {
  await open(page); await page.getByRole('button', { name: 'Открыть Три характера.json', exact: true }).dblclick();
  await instance(page).press('Enter');
}
const editor = page => page.evaluate(async () => {
  const { useEditorStore } = await import('/src/store/editor.ts');
  return useEditorStore.getState().doc;
});
async function scenario(name, run) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try { report.cases[name] = { result: await run(page, context), pageErrors: errors }; }
  catch (error) { report.cases[name] = { diagnosticError: error.message, pageErrors: errors }; }
  finally { await context.close(); }
  console.log(name, JSON.stringify(report.cases[name]));
}

try {
  await scenario('transformOriginExtraction', async page => {
    await open(page);
    return page.evaluate(async () => {
      const { mountSvg } = await import('/src/svg/base.ts');
      const { SelectionModel } = await import('/src/svg/model.ts');
      const { extractSelection } = await import('/src/svg/extract.ts');
      const input = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><g id="target" transform="rotate(30)" transform-origin="50% 50%"><rect x="80" y="90" width="30" height="20" fill="red"/></g></svg>';
      const source = mountSvg(input), model = new SelectionModel(source.svg);
      try {
        const before = new DOMPoint(80, 90).matrixTransform(source.svg.querySelector('rect').getCTM());
        const output = extractSelection(model, [model.forSelector('#target').id]);
        const extracted = mountSvg(output.svg);
        try {
          const after = new DOMPoint(80, 90).matrixTransform(extracted.svg.querySelector('rect').getCTM());
          const expected = { x: before.x - output.bounds.x, y: before.y - output.bounds.y };
          const image = new Image(); image.src = `data:image/svg+xml,${encodeURIComponent(output.svg)}`; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 100;
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 100, 100);
          const pixels = ctx.getImageData(0, 0, 100, 100).data;
          const paintedPixels = Array.from({ length: pixels.length / 4 }, (_, i) => pixels[i * 4 + 3]).filter(Boolean).length;
          return { accepted: true, expected, actual: { x: after.x, y: after.y }, errorUnits: Math.hypot(after.x - expected.x, after.y - expected.y), paintedPixels, input, svg: output.svg };
        } finally { extracted.dispose(); }
      } finally { model.dispose(); source.dispose(); }
    });
  });

  await scenario('pendingNumericSave', async page => {
    await scene(page);
    const input = panel(page).getByRole('spinbutton', { name: 'X', exact: true });
    const save = panel(page).getByRole('button', { name: 'Сохранить', exact: true });
    await input.fill('321');
    const before = { buttonDisabled: await save.isDisabled(), storedX: (await editor(page)).items[0].x };
    // Real mouse click, including when the button is disabled. No forced DOM event.
    const box = await save.boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return { before, after: { dialogCount: await page.getByRole('dialog').count(), storedX: (await editor(page)).items[0].x, buttonDisabled: await save.isDisabled() } };
  });

  await scenario('uncommittedDraftReload', async page => {
    await scene(page);
    await panel(page).getByRole('spinbutton', { name: 'X', exact: true }).fill('321');
    const before = await editor(page), dialogs = [];
    page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
    await page.reload();
    await page.getByRole('complementary', { name: 'Библиотеки' }).waitFor();
    return { modelXBeforeReload: before.items[0].x, nativeDialogs: dialogs, modeAfterReload: (await editor(page)).mode };
  });

  await scenario('tinyFrameOppositeMarker', async page => {
    await scene(page);
    await page.evaluate(async () => {
      const { useEditorStore } = await import('/src/store/editor.ts');
      const store = useEditorStore.getState(), doc = store.doc;
      const item = { ...doc.items[0], svgContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 8"><rect width="3" height="8"/></svg>', x: 200, y: 200, scaleX: 1, scaleY: 1 };
      item.image = `data:image/svg+xml,${encodeURIComponent(item.svgContent)}`;
      store.setDoc({ ...doc, items: [item] }); store.setSelected([item.instanceId]);
    });
    const opposite = page.getByRole('button', { name: 'Масштабировать: nw', exact: true });
    const active = page.getByRole('button', { name: 'Масштабировать: se', exact: true });
    const before = await opposite.boundingBox(), start = await active.boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
    await page.mouse.move(start.x + start.width / 2 + 12, start.y + start.height / 2 + 12, { steps: 5 }); await page.mouse.up();
    const after = await opposite.boundingBox();
    return { before, after, visibleOppositeMarkerMotionPx: Math.hypot(after.x - before.x, after.y - before.y), resulting: (await editor(page)).items[0] };
  });

  await scenario('zeroScaleSvgPath', async page => {
    await open(page);
    return page.evaluate(async () => {
      const { mountSvg } = await import('/src/svg/base.ts');
      const { SelectionModel } = await import('/src/svg/model.ts');
      const { extractSelection } = await import('/src/svg/extract.ts');
      const source = mountSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="a" transform="scale(0)"><path d="M10 10L30 10L30 30Z"/></g></svg>');
      const model = new SelectionModel(source.svg);
      try {
        try { return { exported: true, svg: extractSelection(model, [model.forSelector('#a').id]).svg }; }
        catch (error) { return { exported: false, error: error.message }; }
      } finally { model.dispose(); source.dispose(); }
    });
  });

  await scenario('strokeOnlyDetails', async page => {
    await open(page);
    return page.evaluate(async () => {
      const { mountSvg } = await import('/src/svg/base.ts');
      const { SelectionModel } = await import('/src/svg/model.ts');
      const source = mountSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path id="a" fill="none" stroke="black" stroke-width="4" d="M10 10L30 10L30 30L10 30Z M60 10L80 10L80 30L60 30Z"/></svg>');
      const model = new SelectionModel(source.svg);
      try {
        const node = source.svg.querySelector('path'), p = new DOMPoint(20, 10).matrixTransform(node.getScreenCTM());
        const hit = model.choose(node, p.x, p.y, true);
        return { availableParts: model.stats.parts, deepKind: hit?.kind, deepId: hit?.id };
      } finally { model.dispose(); source.dispose(); }
    });
  });

  await scenario('exportRoundtrip', async page => {
    await scene(page);
    return page.evaluate(async () => {
      const { useEditorStore } = await import('/src/store/editor.ts');
      const { exportComposition } = await import('/src/services/compositionExport.ts');
      const { validateSvgUpload } = await import('/src/services/svgUpload.ts');
      const { parseSvg } = await import('/src/svg/base.ts');
      const text = exportComposition(useEditorStore.getState().doc.items); validateSvgUpload(text);
      try { parseSvg(text); return { acceptedUpload: true, openableAsSource: true }; }
      catch (error) { return { acceptedUpload: true, openableAsSource: false, reason: error.message }; }
    });
  });

  await scenario('unicodeResourceIds', async page => {
    await open(page);
    return page.evaluate(async () => {
      const { mountSvg } = await import('/src/svg/base.ts');
      const { SelectionModel } = await import('/src/svg/model.ts');
      const { extractSelection } = await import('/src/svg/extract.ts');
      const input = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="градиент"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect id="a" width="80" height="80" fill="url(#градиент)"/></svg>';
      const source = mountSvg(input), model = new SelectionModel(source.svg);
      try {
        const paint = getComputedStyle(source.svg.querySelector('rect')).fill;
        try { return { paint, extracted: !!extractSelection(model, [model.forSelector('#a').id]).svg }; }
        catch (error) { return { paint, extracted: false, error: error.message }; }
      } finally { model.dispose(); source.dispose(); }
    });
  });

  await scenario('animatedUploadPreview', async page => {
    await open(page);
    const xml = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>@keyframes pulse{0%,49%{fill:red}50%,100%{fill:blue}}rect{animation:pulse 2s step-end infinite}</style><rect width="100" height="100"/></svg>';
    const processing = await page.evaluate(async xml => {
      const { validateSvgUpload } = await import('/src/services/svgUpload.ts');
      const { parseSvg } = await import('/src/svg/base.ts');
      validateSvgUpload(xml);
      try { parseSvg(xml); return { uploadAccepted: true, processorAccepts: true }; }
      catch (error) { return { uploadAccepted: true, processorAccepts: false, reason: error.message }; }
    }, xml);
    await page.getByRole('button', { name: 'Загрузить SVG', exact: true }).click();
    await page.getByLabel('Выбрать SVG-файлы', { exact: true }).setInputFiles({ name: 'animated.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(xml) });
    await page.getByRole('dialog').getByRole('button', { name: 'Продолжить', exact: true }).click();
    await page.getByRole('textbox', { name: 'Имя файла' }).fill('animated');
    await page.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.getByRole('button', { name: 'Открыть animated.svg', exact: true }).hover();
    const preview = page.getByRole('img', { name: 'Превью animated.svg', exact: true });
    await preview.evaluate(image => image.decode());
    const a = await preview.screenshot({ path: `${folder}/animated-preview-a.png` });
    await new Promise(resolve => setTimeout(resolve, 1100));
    const b = await preview.screenshot({ path: `${folder}/animated-preview-b.png` });
    return { ...processing, screenshotsDiffer: !a.equals(b) };
  });

  await scenario('maliciousInputRejection', async page => {
    await open(page);
    return page.evaluate(async () => {
      const { validateSvgUpload } = await import('/src/services/svgUpload.ts');
      const cases = {
        script: '<script>alert(1)</script>', event: '<rect onload="alert(1)"/>',
        foreignObject: '<foreignObject/>', raster: '<image href="data:image/png;base64,a"/>',
        externalGradient: '<defs><linearGradient href="https://example.invalid/a"/></defs>',
        cssImport: '<style>@import "https://example.invalid/a";</style>',
        externalPaint: '<rect fill="url(https://example.invalid/a)"/>',
        smil: '<animate attributeName="opacity" from="0" to="1" dur="1s"/>',
        encodedHref: '<g href="&#106;avascript:alert(1)"/>',
      };
      return Object.entries(cases).map(([name, content]) => {
        try { validateSvgUpload(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${content}</svg>`); return { name, rejected: false }; }
        catch (error) { return { name, rejected: true, reason: error.message }; }
      });
    });
  });

  await scenario('autonomyAfterDeletingAllLibraryAssets', async page => {
    await scene(page);
    const before = (await editor(page)).items.map(item => item.svgContent);
    await page.evaluate(async () => {
      const { storage } = await import('/src/services/storage.ts');
      const data = await storage.list();
      for (const kind of ['sources', 'components']) for (const record of data[kind]) await storage.remove(kind, record.id);
    });
    await page.reload();
    await page.getByRole('button', { name: 'Открыть Три характера.json', exact: true }).dblclick();
    const after = (await editor(page)).items.map(item => item.svgContent);
    await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить экспорт', exact: true }).click();
    const download = await pending; await download.saveAs(`${folder}/autonomous-after-deletions.svg`);
    return { snapshotsIdentical: JSON.stringify(before) === JSON.stringify(after), instances: after.length, downloadedFilename: download.suggestedFilename() };
  });

  await scenario('snapshotCost', async page => {
    await open(page);
    return page.evaluate(async () => {
      const { snapshot, makeInstances, assetView } = await import('/src/services/views.ts');
      const { storage } = await import('/src/services/storage.ts');
      const asset = assetView((await storage.list()).components[0]), measures = [];
      for (const count of [10, 50, 200]) {
        const items = makeInstances(Array.from({ length: count }, () => asset)), samples = [];
        let length = 0;
        for (let i = 0; i < 5; i++) { const start = performance.now(); length = snapshot(items).length; samples.push(performance.now() - start); }
        samples.sort((a, b) => a - b); measures.push({ count, svgBytesPerInstance: asset.svgContent.length, serializedChars: length, medianMs: samples[2], maxMs: samples[4] });
      }
      return measures;
    });
  });

  await writeFile(`${folder}/deep-observations.json`, JSON.stringify(report, null, 2) + '\n');
  const svg = report.cases.transformOriginExtraction?.result?.svg;
  if (svg) await writeFile(`${folder}/transform-origin-extracted.svg`, svg);
  if (report.cases.transformOriginExtraction?.result?.input) await writeFile(`${folder}/transform-origin-original.svg`, report.cases.transformOriginExtraction.result.input);
} finally { await browser.close(); }
