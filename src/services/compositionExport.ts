import { freezeCompleteSvg, mountSvg, SVG_NS } from '../svg/base';
import { geometry, svgSize, svgTransform } from './transforms';
import type { InstanceView } from '../types/editor';
import { fragmentId } from '../svg/fragment';

function isolateIds(root: SVGSVGElement) {
  const elements = [root, ...root.querySelectorAll('*')];
  const ids = new Map<string, { node: Element; id: string }[]>();
  const newIds = new Map<Element, string>();
  const prefix = `export-${crypto.randomUUID()}-`;
  for (const node of elements) if (node.id) {
    const id = `${prefix}${newIds.size}`;
    ids.set(node.id, [...ids.get(node.id) ?? [], { node, id }]); newIds.set(node, id);
  }
  const lookup = (id: string, uri = true) => {
    const value = ids.get(uri ? fragmentId(id) : id);
    if (!value) throw new Error(`Не найдена SVG-зависимость «${id}».`);
    if (value.length !== 1) throw new Error(`Ссылка на повторяющийся ID «${id}» неоднозначна.`);
    return value[0].id;
  };
  for (const node of elements) {
    if (node.id) node.id = newIds.get(node)!;
    for (const attribute of [...node.attributes]) {
      if (attribute.localName === 'href' && attribute.value.startsWith('#')) attribute.value = `#${lookup(attribute.value.slice(1))}`;
      else if (['aria-labelledby', 'aria-describedby'].includes(attribute.localName)) {
        attribute.value = attribute.value.trim().split(/\s+/).filter(id => ids.has(id)).map(id => lookup(id, false)).join(' ');
      } else attribute.value = attribute.value.replace(/url\(\s*['"]?#([^'"\s)]+)['"]?\s*\)/gi, (_, id: string) => `url(#${lookup(id)})`);
    }
  }
  const gradients = new Map([...root.querySelectorAll('linearGradient,radialGradient')].map(node => [node.id, node]));
  const visited = new Set<Element>(), active = new Set<Element>();
  const visit = (node: Element) => {
    if (active.has(node)) throw new Error('Циклическая зависимость градиентов.');
    if (visited.has(node)) return;
    active.add(node);
    const href = node.getAttribute('href') ?? node.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    const parent = href ? gradients.get(href.slice(1)) : undefined;
    if (parent) visit(parent);
    active.delete(node); visited.add(node);
  };
  for (const node of gradients.values()) visit(node);
}

/** Assemble vector DOM from immutable snapshots, independent of editor UI/zoom. */
export function exportComposition(items: readonly InstanceView[]): string {
  if (!items.length) throw new Error('Добавьте хотя бы один компонент для экспорта.');
  const output = document.createElementNS(SVG_NS, 'svg');
  output.setAttribute('data-peeps-export', '1');
  output.setAttribute('width', '1200'); output.setAttribute('height', '800');
  output.setAttribute('viewBox', '0 0 1200 800');
  for (const item of items) {
    try {
      const box = geometry(item);
      if (![item.x, item.y, item.scaleX, item.scaleY, item.rotation, box.width, box.height, box.cx, box.cy, item.x + box.width, item.y + box.height].every(Number.isFinite)
        || item.scaleX <= 0 || item.scaleY <= 0 || box.width <= 0 || box.height <= 0) throw new Error('Некорректные координаты или размеры экземпляра.');
      const mounted = mountSvg(item.svgContent);
      try {
        const viewport = freezeCompleteSvg(mounted.svg), size = svgSize(item.svgContent);
        isolateIds(viewport);
        viewport.setAttribute('x', '0'); viewport.setAttribute('y', '0');
        viewport.setAttribute('width', String(size.width)); viewport.setAttribute('height', String(size.height));
        // Match an SVG image's viewport clipping, including negative viewBox origins.
        viewport.setAttribute('overflow', 'hidden');
        const group = document.createElementNS(SVG_NS, 'g');
        group.setAttribute('transform', svgTransform({ ...item, rotation: item.rotation % 360 }));
        group.append(viewport); output.append(group);
      } finally { mounted.dispose(); }
    } catch (reason) {
      throw new Error(`Не удалось экспортировать «${item.name}»: ${(reason as Error).message}`);
    }
  }
  return new XMLSerializer().serializeToString(output);
}

export const exportFilename = (name: string) => `${name.replace(/\.(?:json|svg)$/i, '').replace(/[\\/\u0000-\u001f]/g, '_').trim() || 'Композиция'}.svg`;

export function downloadComposition(svg: string, filename: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  try { document.body.append(link); link.click(); }
  catch (reason) { URL.revokeObjectURL(url); throw reason; }
  finally { link.remove(); }
  // Keep the URL alive until the browser has started reading the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
