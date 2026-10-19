import { expect, type Page } from '@playwright/test';

export async function sourcePoint(page: Page, selector = '[id^="face/"] > path', indices?: number[]) {
  await expect(page.getByTestId('source-canvas').locator('svg').first()).toBeAttached();
  return page.getByTestId('source-canvas').evaluate((container, { selector, indices }) => {
    const host = container.firstElementChild as HTMLElement;
    const shadow = host.shadowRoot!, source = shadow.querySelector('svg')!;
    const node = source.querySelector(selector) as SVGGraphicsElement;
    if (!node) throw new Error(`Missing source node: ${selector}`);
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    holder.style.cssText = 'position:fixed;left:-10000px;';
    if (indices) {
      const d = node.getAttribute('d')!;
      if (d.includes('m')) throw new Error('Manual reference needs original absolute M subpaths');
      const parts = d.match(/M[^M]+/g)!;
      probe.setAttribute('d', indices.map(index => parts[index]).join(' '));
      probe.setAttribute('fill-rule', getComputedStyle(node).fillRule);
      holder.append(probe); document.body.append(holder);
    }
    try {
      const geometry = indices ? probe : node as SVGGeometryElement;
      const box = geometry.getBBox(), matrix = node.getScreenCTM()!, inverse = matrix.inverse();
      const fractions = Array.from({ length: 51 }, (_, i) => (i + .5) / 51).sort((a, b) => Math.abs(a - .5) - Math.abs(b - .5));
      for (const y of fractions) for (const x of fractions) {
        const projected = new DOMPoint(box.x + box.width * x, box.y + box.height * y).matrixTransform(matrix);
        const point = { x: Math.round(projected.x), y: Math.round(projected.y) };
        const local = new DOMPoint(point.x, point.y).matrixTransform(inverse);
        if (point.y > 0 && point.y < innerHeight && point.x > 0 && point.x < innerWidth &&
          geometry.isPointInFill(local) && shadow.elementFromPoint(point.x, point.y) === node && document.elementFromPoint(point.x, point.y) === host) return point;
      }
      throw new Error(`No visible painted point for ${selector}`);
    } finally { holder.remove(); }
  }, { selector, indices });
}

export async function clickSource(page: Page, options: { selector?: string; indices?: number[]; shift?: boolean; double?: boolean } = {}) {
  const point = await sourcePoint(page, options.selector, options.indices);
  if (options.shift) await page.keyboard.down('Shift');
  if (options.double) await page.mouse.dblclick(point.x, point.y); else await page.mouse.click(point.x, point.y);
  if (options.shift) await page.keyboard.up('Shift');
}
