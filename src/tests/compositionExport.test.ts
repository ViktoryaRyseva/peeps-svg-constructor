import { expect, it } from 'vitest';
import { exportComposition, exportFilename } from '../services/compositionExport';
import type { InstanceView } from '../types/editor';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -10 100 50"><rect x="-20" y="-10" width="100" height="50" fill="red"/></svg>';
const item: InstanceView = { id: 'c', instanceId: 'i', name: 'a.svg', svgContent: svg, image: 'not-used', x: 100, y: 200, scaleX: 2, scaleY: .5, rotation: 90 };
const parse = (text: string) => new DOMParser().parseFromString(text, 'image/svg+xml');

it('exports the fixed transparent viewport, original vector geometry and layer order', () => {
  const source = JSON.stringify(item);
  const xml = parse(exportComposition([item, { ...item, instanceId: 'copy', x: 300 }]));
  expect(xml.querySelector('parsererror')).toBeNull();
  const root = xml.documentElement;
  expect([root.getAttribute('width'), root.getAttribute('height'), root.getAttribute('viewBox')]).toEqual(['1200', '800', '0 0 1200 800']);
  expect(root.children).toHaveLength(2); expect(root.querySelectorAll('rect')).toHaveLength(2);
  expect(root.querySelector('svg')?.getAttribute('viewBox')).toBe('-20 -10 100 50');
  expect(root.querySelector('image,foreignObject,script,style')).toBeNull();
  expect(JSON.stringify(item)).toBe(source);
  const group = document.createElementNS(root.namespaceURI, 'g') as SVGGElement;
  group.setAttribute('transform', root.children[0].getAttribute('transform')!);
  const center = new DOMPoint(50, 25).matrixTransform(group.transform.baseVal.consolidate()!.matrix);
  expect(center.x).toBeCloseTo(200); expect(center.y).toBeCloseTo(212.5);
  expect(root.children[1].getAttribute('transform')).toContain('translate(400 212.5)');
});

const resourceSvg = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">
  <style>.paint {fill:url(#gradient)} #end {stop-color:${color}}</style>
  <defs><linearGradient id="base"><stop stop-color="white"/><stop id="end" offset="1"/></linearGradient>
    <linearGradient id="gradient" href="#base"/><clipPath id="clip"><rect width="90" height="50"/></clipPath>
    <mask id="mask"><rect width="100" height="50" fill="white"/></mask></defs>
  <rect id="shape" class="paint" width="100" height="50" clip-path="url(#clip)" mask="url(#mask)"/>
</svg>`;
it('freezes conflicting CSS and isolates gradients, inherited href, clipPath and mask for each copy', () => {
  const xml = parse(exportComposition([{ ...item, svgContent: resourceSvg('red') }, { ...item, svgContent: resourceSvg('blue') }]));
  const ids = [...xml.querySelectorAll('[id]')].map(node => node.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(xml.querySelector('style,[class]')).toBeNull();
  for (const viewport of xml.documentElement.children) {
    const local = new Set([...viewport.querySelectorAll('[id]')].map(node => node.id));
    for (const node of viewport.querySelectorAll('*')) for (const attr of node.attributes) {
      if (attr.localName === 'href') expect(local.has(attr.value.slice(1))).toBe(true);
      for (const match of attr.value.matchAll(/url\(#([^)]+)\)/g)) expect(local.has(match[1])).toBe(true);
    }
  }
  const stops = [...xml.querySelectorAll('stop[offset="1"]')];
  expect(stops[0].getAttribute('style')).toContain('rgb(255, 0, 0)');
  expect(stops[1].getAttribute('style')).toContain('rgb(0, 0, 255)');
});

it('normalizes huge finite rotation for export without mutating the editor angle', () => {
  const xml = parse(exportComposition([{ ...item, rotation: 1e308 }]));
  expect(xml.documentElement.firstElementChild!.getAttribute('transform')).toContain(`rotate(${1e308 % 360})`);
});

for (const [name, content] of [
  ['missing reference', svg.replace('fill="red"', 'fill="url(#missing)"')],
  ['ambiguous reference', svg.replace('<rect ', '<g id="a"/><g id="a"/><rect ').replace('fill="red"', 'fill="url(#a)"')],
  ['unsupported element', svg.replace('<rect ', '<text>hello</text><rect ')],
  ['cyclic gradient', svg.replace('<rect ', '<defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs><rect ')],
  ['malformed XML', '<svg>'],
]) it(`rejects ${name} without leaking temporary DOM`, () => {
  const before = document.body.children.length;
  expect(() => exportComposition([{ ...item, svgContent: content }])).toThrow('Не удалось экспортировать');
  expect(document.body.children.length).toBe(before);
});
it('uniquely renames harmless repeated IDs present in original Peep artwork', () => {
  const text = svg.replace('<rect ', '<g id="a"/><g id="a"/><rect ');
  const xml = parse(exportComposition([{ ...item, svgContent: text }]));
  const ids = [...xml.querySelectorAll('[id]')].map(node => node.id);
  expect(ids).toHaveLength(2); expect(new Set(ids).size).toBe(2);
});
it('rejects empty or overflowing scenes and cleans up preceding valid instances', () => {
  expect(() => exportComposition([])).toThrow('Добавьте');
  const before = document.body.children.length;
  for (const invalid of [{ scaleX: 1e308 }, { rotation: NaN }, { scaleY: 0 }, { x: Infinity }]) {
    expect(() => exportComposition([item, { ...item, ...invalid }])).toThrow('Некорректные');
    expect(document.body.children.length).toBe(before);
  }
});
it('uses a safe SVG filename for saved and new compositions', () => {
  expect(exportFilename('Три характера.json')).toBe('Три характера.svg');
  expect(exportFilename('Новая композиция')).toBe('Новая композиция.svg');
  expect(exportFilename('a/b.svg')).toBe('a_b.svg');
});

it('matches independently painted SVG images: masks, CSS collisions, negative origins and transforms', async () => {
  const items = [
    { ...item, svgContent: resourceSvg('red'), x: 80, y: 90, scaleX: 2.1, scaleY: 1.4, rotation: 37 },
    { ...item, svgContent: resourceSvg('blue'), x: 180, y: 140, scaleX: 1.8, scaleY: .9, rotation: -23 },
    { ...item, x: -20, y: 5, scaleX: 1.2, scaleY: 2, rotation: 19 },
  ];
  const image = async (text: string) => {
    const img = new Image(); img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
    await img.decode(); return img;
  };
  const canvas = () => { const value = document.createElement('canvas'); value.width = 1200; value.height = 800; return value; };
  const actual = canvas(), expected = canvas(), ctx = expected.getContext('2d')!;
  for (const entry of items) {
    const img = await image(entry.svgContent), w = 100, h = 50;
    ctx.save(); ctx.translate(entry.x + w * entry.scaleX / 2, entry.y + h * entry.scaleY / 2);
    ctx.rotate(entry.rotation * Math.PI / 180); ctx.scale(entry.scaleX, entry.scaleY);
    ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore();
  }
  actual.getContext('2d')!.drawImage(await image(exportComposition(items)), 0, 0);
  const a = actual.getContext('2d')!.getImageData(0, 0, 1200, 800).data;
  const b = ctx.getImageData(0, 0, 1200, 800).data;
  let absoluteError = 0, painted = 0, different = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] || b[i + 3]) {
      painted++; let error = Math.abs(a[i + 3] - b[i + 3]);
      for (let c = 0; c < 3; c++) error += Math.abs(a[i + c] * a[i + 3] / 255 - b[i + c] * b[i + 3] / 255);
      absoluteError += error; if (error > 32) different++;
    }
  }
  expect(painted).toBeGreaterThan(10000);
  expect(absoluteError / painted / 4).toBeLessThan(1);
  expect(different / painted).toBeLessThan(.02);
  expect(a[a.length - 1]).toBe(0);
});
