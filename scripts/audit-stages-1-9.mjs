// Diagnostic observations, NOT acceptance assertions that the observed defects are correct.
// Uses a fresh browser context: never opens or modifies the user's browser database.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const origin = process.env.AUDIT_ORIGIN ?? 'http://127.0.0.1:5173';
const report = { observedAt: new Date().toISOString(), origin };
try {
  const page = await context.newPage();
  await page.goto(origin);
  await page.getByRole('complementary', { name: 'Библиотеки' }).waitFor();
  report.processor = await page.evaluate(async () => {
    const { mountSvg, parseSvg } = await import('/src/svg/base.ts');
    const { SelectionModel } = await import('/src/svg/model.ts');
    const { validateSvgUpload, readSvgFiles } = await import('/src/services/svgUpload.ts');
    const { StorageService } = await import('/src/services/storage.ts');
    const { rotate, resizeInstance, geometry } = await import('/src/services/transforms.ts');
    const wrap = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80">${body}</svg>`;
    const valid = wrap('<rect width="100" height="80"/>');
    const service = new StorageService(`audit-${crypto.randomUUID()}`);
    await service.open();
    const output = {};
    try {
      output.uploadMismatch = [];
      for (const [kind, text] of [
        ['missing-viewBox', '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80"/></svg>'],
        ['text', wrap('<text x="10" y="30">Hello</text>')],
        ['use', wrap('<defs><rect id="r" width="20" height="20"/></defs><use href="#r"/>')],
      ]) {
        const saved = await service.addAsset('sources', kind, text);
        let error = null;
        try { parseSvg(saved.svgContent); } catch (reason) { error = reason.message; }
        output.uploadMismatch.push({ kind, saved: true, openError: error });
      }
      const malformed = wrap('<path d="M 0 0 L"/>');
      validateSvgUpload(malformed);
      const before = document.body.children.length;
      const errors = [];
      for (let attempt = 0; attempt < 10; attempt++) {
        const mounted = mountSvg(malformed);
        try { new SelectionModel(mounted.svg).dispose(); }
        catch (reason) { errors.push(reason.message); }
        finally { mounted.dispose(); }
      }
      output.malformedPath = { acceptedByUpload: true, errors, leakedHosts: document.body.children.length - before };
      const item = { id: 'component', instanceId: 'instance', name: 'a.svg', svgContent: valid, image: '', x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 1e308 };
      const changed = resizeInstance(item, 'e', rotate({ x: 50, y: 0 }, item.rotation));
      output.numeric = { rotation: item.rotation, allResultValuesFinite: [changed.x, changed.y, changed.scaleX, changed.scaleY].every(Number.isFinite) };
      await service.saveComposition({ schemaVersion: 1, id: 'extreme', name: 'extreme', width: 1200, height: 800,
        instances: [{ id: 'i', componentId: 'c', svgContent: valid, x: 0, y: 0, scaleX: 1e308, scaleY: 1, rotation: 0, zIndex: 0 }] });
      output.numeric.overflowingGeometryStored = !Number.isFinite(geometry({ ...item, scaleX: 1e308 }).width);
      // This is a modest valid file, not an attempt to exhaust memory or freeze the browser.
      const many = wrap('<rect width="1" height="1"/>'.repeat(20000));
      const started = performance.now();
      const upload = await readSvgFiles([new File([many], 'many.svg')]);
      output.limits = { bytes: new TextEncoder().encode(many).length, nodes: 20000, accepted: upload.valid.length === 1, validationMs: performance.now() - started };
      // Many instances naturally cross the bottom of the fixed canvas at their default coordinates.
      const { makeInstances, assetView } = await import('/src/services/views.ts');
      const assets = Array.from({ length: 36 }, (_, i) => assetView({ id: String(i), name: String(i), svgContent: valid, createdAt: '' }));
      const placed = makeInstances(assets);
      output.placement = { count: placed.length, entirelyOutsideCanvas: placed.filter(i => i.x >= 1200 || i.y >= 800).length, lastY: placed.at(-1).y };
    } finally { await service.db.delete(); }
    return output;
  });
  const other = await context.newPage();
  await other.goto(origin);
  await other.getByRole('complementary', { name: 'Библиотеки' }).waitFor();
  for (const tab of [page, other]) await tab.getByRole('button', { name: 'Открыть Три характера.json', exact: true }).dblclick();
  const panel = tab => tab.getByRole('complementary', { name: 'Правая панель инструментов' });
  async function editAndSave(tab, field, value) {
    await tab.getByRole('button', { name: /^Выделить экземпляр/ }).first().press('Enter');
    const input = panel(tab).getByRole('spinbutton', { name: field, exact: true });
    await input.fill(String(value)); await input.press('Enter');
    await panel(tab).getByRole('button', { name: 'Сохранить', exact: true }).click();
    await tab.getByRole('button', { name: 'Да, перезаписать', exact: true }).click();
    await tab.waitForFunction(() => !document.querySelector('dialog[open]') || [...document.querySelectorAll('dialog[open] [role="alert"]')].some(node => node.textContent.includes('другой вкладке')));
    if (await tab.getByRole('dialog').count()) await tab.getByRole('button', { name: 'Нет, оставить черновик', exact: true }).click();
  }
  await editAndSave(page, 'X', 111);
  await editAndSave(other, 'Y', 222);
  report.concurrentSave = await other.evaluate(async () => {
    const { storage } = await import('/src/services/storage.ts');
    const current = (await storage.list()).compositions.find(i => i.id === 'composition-1').instances[0];
    return { expectedXFromFirstTab: 111, storedX: current.x, storedY: current.y, firstTabChangeLost: current.x !== 111 };
  });
  // Confirm the numeric defect through normal controls as well as direct module calls.
  await editAndSave(other, 'Поворот', 1e308);
  const width = panel(other).getByRole('spinbutton', { name: 'Ширина', exact: true });
  await width.fill('150'); await width.press('Enter');
  report.numericUi = await other.evaluate(async () => {
    const { useEditorStore } = await import('/src/store/editor.ts');
    const item = useEditorStore.getState().doc.items[0];
    return { allValuesFinite: [item.x, item.y, item.scaleX, item.scaleY, item.rotation].every(Number.isFinite), transform: document.querySelector('[data-testid="instance"]').getAttribute('data-svg-transform') };
  });
  const routes = ['/experiments/svg/index.html', '/experiments/svg-v2/index.html'];
  report.removedRoutes = await Promise.all(routes.map(async route => ({ route, status: (await context.request.get(origin + route)).status() })));
  const outputDir = process.env.AUDIT_OUTPUT_DIR ?? 'docs/audit-stages-1-9-artifacts';
  await mkdir(outputDir, { recursive: true });
  await writeFile(`${outputDir}/observations.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
