import { SVG_NS, SvgExtractionError } from './base';
import { fragmentId } from './fragment';

const properties = ['color', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'display', 'visibility', 'clip-path', 'clip-rule', 'mask-type', 'stop-color', 'stop-opacity', 'paint-order', 'shape-rendering', 'color-interpolation'];
const resourceId = (value: string) => {
  const match = value.match(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/i);
  return match ? fragmentId(new URL(match[1], location.href).hash.slice(1)) : null;
};
const fraction = (value: string) => {
  if (!/^[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?%?$/i.test(value.trim())) throw new SvgExtractionError('UNSUPPORTED_RESOURCE_UNITS', `Неподдерживаемая координата ресурса: ${value}`);
  return Number.parseFloat(value) / (value.endsWith('%') ? 100 : 1);
};
const matrixText = (m: DOMMatrix) => `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`;
function transform(value: string | null): DOMMatrix {
  const probe = document.createElementNS(SVG_NS, 'g');
  if (value) probe.setAttribute('transform', value);
  const m = probe.transform.baseVal.consolidate()?.matrix;
  return m ? new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]) : new DOMMatrix();
}

/** Freeze bbox-relative paint/effects before replacing d or pruning ancestors. */
export function freezeResourceCoordinates(root: SVGSVGElement, selected: SVGGraphicsElement[]) {
  const originalIds = new Map<string, Element[]>();
  for (const node of [root, ...root.querySelectorAll('*')]) if (node.id) originalIds.set(node.id, [...originalIds.get(node.id) ?? [], node]);
  const lookup = (id: string) => {
    const matches = originalIds.get(id) ?? [];
    if (matches.length !== 1) throw new SvgExtractionError('AMBIGUOUS_REFERENCE', `Зависимость «${id}» отсутствует или имеет повторяющийся ID.`);
    return matches[0];
  };
  const defs = document.createElementNS(SVG_NS, 'defs');
  const contexts = [root, ...root.querySelectorAll('svg,g,path,rect,circle,ellipse,line,polyline,polygon')].filter(node => !node.closest('defs,clipPath,mask') && selected.some(item => item === node || item.contains(node) || node.contains(item))).map(node => {
    const style = getComputedStyle(node);
    return { node: node as SVGGraphicsElement, box: (node as SVGGraphicsElement).getBBox(), fill: style.fill, stroke: style.stroke, clip: style.clipPath, mask: style.maskImage };
  });
  function inherited(resource: Element, attribute: string, defaultValue: string, visited = new Set<Element>()): string {
    if (visited.has(resource)) throw new SvgExtractionError('CYCLIC_DEPENDENCY', 'Цикл наследования градиента.');
    visited.add(resource);
    const own = resource.getAttribute(attribute);
    if (own !== null) return own;
    const href = resource.getAttribute('href') ?? resource.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    return href?.startsWith('#') ? inherited(lookup(fragmentId(href.slice(1))), attribute, defaultValue, visited) : defaultValue;
  }
  function cloneFrozen(original: Element): Element {
    const clone = original.cloneNode(false) as SVGElement;
    clone.removeAttribute('class'); clone.removeAttribute('style');
    const style = getComputedStyle(original);
    for (const property of properties) clone.style.setProperty(property, style.getPropertyValue(property));
    const mask = resourceId(style.maskImage); if (mask) clone.setAttribute('mask', `url(#${encodeURIComponent(mask)})`);
    for (const child of original.children) clone.append(cloneFrozen(child));
    return clone;
  }
  function copy(resource: Element) {
    const clone = cloneFrozen(resource);
    const ids = new Map<string, string>();
    for (const node of [clone, ...clone.querySelectorAll('*')]) if (node.id) {
      if (ids.has(node.id)) throw new SvgExtractionError('AMBIGUOUS_REFERENCE', 'Повторяющийся ID внутри определения эффекта.');
      const old = node.id; node.id = `resource-${crypto.randomUUID()}`; ids.set(old, node.id);
    }
    if (!clone.id) clone.id = `resource-${crypto.randomUUID()}`;
    for (const node of [clone, ...clone.querySelectorAll('*')]) for (const attribute of [...node.attributes]) {
      if (attribute.localName === 'href' && attribute.value.startsWith('#') && ids.has(fragmentId(attribute.value.slice(1)))) attribute.value = `#${ids.get(fragmentId(attribute.value.slice(1)))}`;
      else attribute.value = attribute.value.replace(/url\(\s*['"]?#([^'"\s)]+)['"]?\s*\)/g, (whole, id: string) => ids.has(fragmentId(id)) ? `url(#${ids.get(fragmentId(id))})` : whole);
    }
    defs.append(clone); return clone;
  }
  for (const { node, box, fill, stroke, clip, mask } of contexts) {
    const mapping = new DOMMatrix().translate(box.x, box.y).scale(box.width, box.height);
    if (node.localName !== 'g' && node !== root) for (const [property, value] of [['fill', fill], ['stroke', stroke]]) {
      const id = resourceId(value); if (!id) continue;
      const gradient = lookup(id);
      if (!['linearGradient', 'radialGradient'].includes(gradient.localName)) throw new SvgExtractionError('UNSUPPORTED_DEPENDENCY', 'Пока поддерживаются только локальные градиенты заливки/обводки.');
      if (inherited(gradient, 'gradientUnits', 'objectBoundingBox') !== 'objectBoundingBox') {
        const defaults = gradient.localName === 'linearGradient' ? { x1: '0%', y1: '0%', x2: '100%', y2: '0%' } : { cx: '50%', cy: '50%', r: '50%', fx: inherited(gradient, 'cx', '50%'), fy: inherited(gradient, 'cy', '50%'), fr: '0%' };
        if (Object.entries(defaults).some(([key, value]) => inherited(gradient, key, value).includes('%'))) throw new SvgExtractionError('VIEWPORT_RESOURCE_UNITS', 'Процентные координаты userSpaceOnUse-градиента зависят от исходного viewport; задайте явные числовые координаты.');
        continue;
      }
      if (!box.width || !box.height) throw new SvgExtractionError('EMPTY_RESOURCE_BOX', 'Нет ненулевой рамки для градиента.');
      const clone = copy(gradient);
      clone.setAttribute('gradientUnits', 'userSpaceOnUse');
      const defaults = gradient.localName === 'linearGradient' ? { x1: '0', y1: '0', x2: '1', y2: '0' } : { cx: '.5', cy: '.5', r: '.5', fx: inherited(gradient, 'cx', '.5'), fy: inherited(gradient, 'cy', '.5'), fr: '0' };
      for (const [name, defaultValue] of Object.entries(defaults)) clone.setAttribute(name, String(fraction(inherited(gradient, name, defaultValue))));
      clone.setAttribute('gradientTransform', matrixText(mapping.multiply(transform(inherited(gradient, 'gradientTransform', '')))));
      node.style.setProperty(property, `url(#${clone.id})`, 'important');
    }
    const clipId = resourceId(clip);
    if (clipId) {
      const original = lookup(clipId);
      if ((original.getAttribute('clipPathUnits') ?? 'userSpaceOnUse') === 'objectBoundingBox') {
        const clone = copy(original); clone.setAttribute('clipPathUnits', 'userSpaceOnUse');
        clone.setAttribute('transform', matrixText(mapping.multiply(transform(original.getAttribute('transform')))));
        node.style.setProperty('clip-path', `url(#${clone.id})`, 'important');
      }
    }
    const maskId = resourceId(mask);
    if (maskId) {
      const original = lookup(maskId);
      const regionBBox = (original.getAttribute('maskUnits') ?? 'objectBoundingBox') === 'objectBoundingBox';
      const contentBBox = original.getAttribute('maskContentUnits') === 'objectBoundingBox';
      if (!regionBBox && ['x', 'y', 'width', 'height'].some(key => (original.getAttribute(key) ?? '%').includes('%'))) throw new SvgExtractionError('VIEWPORT_RESOURCE_UNITS', 'Процентная область userSpaceOnUse-маски зависит от исходного viewport; задайте явные числовые координаты.');
      if (regionBBox || contentBBox) {
        const clone = copy(original);
        if (regionBBox) {
          clone.setAttribute('maskUnits', 'userSpaceOnUse');
          clone.setAttribute('x', String(box.x + fraction(original.getAttribute('x') ?? '-10%') * box.width));
          clone.setAttribute('y', String(box.y + fraction(original.getAttribute('y') ?? '-10%') * box.height));
          clone.setAttribute('width', String(fraction(original.getAttribute('width') ?? '120%') * box.width));
          clone.setAttribute('height', String(fraction(original.getAttribute('height') ?? '120%') * box.height));
        }
        if (contentBBox) {
          clone.setAttribute('maskContentUnits', 'userSpaceOnUse');
          const group = document.createElementNS(SVG_NS, 'g'); group.setAttribute('transform', matrixText(mapping));
          group.append(...clone.childNodes); clone.append(group);
        }
        node.style.setProperty('mask-image', `url(#${clone.id})`, 'important');
      }
    }
  }
  if (defs.children.length) root.append(defs);
}
