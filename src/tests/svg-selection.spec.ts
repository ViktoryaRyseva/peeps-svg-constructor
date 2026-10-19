import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type {} from './fixtures/currentDriver';
import { openSvgFixture } from './fixtures/openSvgFixture';

const face = '[id^="face/"] > path';
test.beforeAll(async () => { await mkdir('test-artifacts/svg-details', { recursive: true }); });
// Fixed acceptance indices, shared with the independent face visual references.
const people = [
  { name: 'sitting-7', parts: [0, 1, 2, 3, 4, 5], eyes: [2, 3] },
  { name: 'sitting-10', parts: [0, 1, 2, 11, 12, 13], eyes: [11, 12] },
  { name: 'standing-24', parts: [0, 3, 5, 6, 7, 8], eyes: [5, 6] },
];

/** Find a painted pixel of an accepted detail, then drive a real mouse.
 * No selection API / dispatched synthetic events are used for interaction.
 * Native source hit testing confirms the actual artwork receives the click.
 */
async function pointFor(page: Page, part: number) {
  return page.evaluate(({ selector, part }) => {
    const candidate = window.svgSelectionHarness.model().forSelector(selector, part);
    const probe = candidate.probe!, matrix = candidate.node.getScreenCTM()!, inverse = matrix.inverse();
    const box = probe.getBBox(), source = document.querySelector('#source')!.getBoundingClientRect();
    const shadow = candidate.node.getRootNode() as ShadowRoot;
    const fractions = Array.from({ length: 41 }, (_, i) => (i + .5) / 41).sort((a, b) => Math.abs(a - .5) - Math.abs(b - .5));
    for (const y of fractions) for (const x of fractions) {
      const screen = new DOMPoint(box.x + box.width * x, box.y + box.height * y).matrixTransform(matrix);
      // The physical pointer can be placed on an integer CSS pixel.
      const point = { x: Math.round(screen.x), y: Math.round(screen.y) };
      if (point.x <= source.left || point.x >= source.right || point.y <= source.top || point.y >= source.bottom || point.y >= innerHeight) continue;
      const local = new DOMPoint(point.x, point.y).matrixTransform(inverse);
      if (probe.isPointInFill(local) && shadow.elementFromPoint(point.x, point.y) === candidate.node) return { ...point, id: candidate.id };
    }
    throw new Error(`No visible painted point for ${candidate.label}`);
  }, { selector: face, part });
}

for (const person of people) for (const zoom of ['1', '.5', '2']) {
  test(`face mouse access: ${person.name} at ${Number(zoom) * 100}%`, async ({ page }) => {
    await openSvgFixture(page, 'current');
    await page.waitForFunction(() => window.svgSelectionHarness?.root());
    await page.getByLabel('Исходник:').selectOption(`peep-${person.name}.svg`);
    await expect(page.getByRole('status')).toContainText('Самостоятельных деталей:');
    await expect.poll(() => page.evaluate(() => window.svgSelectionHarness.sourceText())).toContain(person.name === 'standing-24' ? 'robot_dance' : person.name === 'sitting-7' ? 'crossed_legs' : 'hands_back');
    await page.getByLabel('Масштаб:').selectOption(zoom);
    await page.locator('#source').scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => new XMLSerializer().serializeToString(window.svgSelectionHarness.root()));
    for (const part of person.parts) {
      const point = await pointFor(page, part);
      await page.mouse.click(point.x, point.y);
      expect(await page.evaluate(() => window.svgSelectionHarness.selection().map(value => value.kind))).toEqual(['group']);
      await page.mouse.dblclick(point.x, point.y);
      expect(await page.evaluate(() => window.svgSelectionHarness.selection())).toEqual([{ id: point.id, kind: 'part' }]);
    }
    const first = await pointFor(page, person.eyes[0]), second = await pointFor(page, person.eyes[1]);
    await page.mouse.dblclick(first.x, first.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(second.x, second.y);
    await page.keyboard.up('Shift');
    expect(await page.evaluate(() => window.svgSelectionHarness.selection().map(value => value.id).sort())).toEqual([first.id, second.id].sort());
    if (person.name === 'sitting-10' && zoom === '2') {
      await mkdir('test-artifacts/svg-details', { recursive: true });
      await page.screenshot({ path: 'test-artifacts/svg-details/mouse-two-eyes.png', fullPage: true });
    }
    // This is the exported selection produced by mouse gestures, not API select().
    const extracted = await page.evaluate(() => window.svgSelectionHarness.run());
    expect(extracted.detailCount).toBe(2); expect(extracted.selectedCount).toBe(2);
    expect(extracted.svg.match(/<path\b/g)).toHaveLength(1);
    await writeFile(`test-artifacts/svg-details/mouse-${person.name}-${Number(zoom) * 100}.json`, JSON.stringify({ person: person.name, zoom: Number(zoom), accessedDetails: person.parts, eyes: person.eyes, selected: [first.id, second.id], detailCount: extracted.detailCount, bounds: extracted.bounds }, null, 2) + '\n');
    await page.keyboard.down('Shift'); await page.mouse.click(second.x, second.y); await page.keyboard.up('Shift');
    expect(await page.evaluate(() => window.svgSelectionHarness.selection())).toEqual([{ id: first.id, kind: 'part' }]);
    // Shift from a selected parent must refine it instead of silently discarding the child.
    await page.mouse.click(first.x, first.y);
    await page.keyboard.down('Shift'); await page.mouse.click(first.x, first.y); await page.keyboard.up('Shift');
    expect(await page.evaluate(() => window.svgSelectionHarness.selection())).toEqual([{ id: first.id, kind: 'part' }]);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.svgSelectionHarness.selection())).toEqual([]);
    expect(await page.evaluate(() => new XMLSerializer().serializeToString(window.svgSelectionHarness.root()))).toBe(before);
  });
}

test('holes and background are not details; Shift double-click does not erase other selected elements', async ({ page }) => {
  await openSvgFixture(page, 'current');
  await page.waitForFunction(() => window.svgSelectionHarness?.root());
  await page.getByLabel('Исходник:').selectOption('topology.svg');
  await expect(page.getByRole('status')).toContainText('Самостоятельных деталей: 4');
  await page.locator('#donut').dblclick({ position: { x: 10, y: 10 } });
  const before = await page.evaluate(() => window.svgSelectionHarness.selection());
  await page.locator('#donut').dblclick({ position: { x: 140, y: 10 }, modifiers: ['Shift'] });
  expect(await page.evaluate(() => window.svgSelectionHarness.selection())).toEqual(before);
  // A locator click correctly refuses a point in a hole because the SVG root
  // receives it. Use a real screen coordinate to test that background hit.
  const box = (await page.locator('#donut').boundingBox())!;
  await page.keyboard.down('Shift'); await page.mouse.click(box.x + 40, box.y + 40); await page.keyboard.up('Shift');
  expect(await page.evaluate(() => window.svgSelectionHarness.selection())).toEqual(before);
  await page.mouse.dblclick(box.x + 40, box.y + 40);
  expect(await page.evaluate(() => window.svgSelectionHarness.selection())).toEqual([]);
});
