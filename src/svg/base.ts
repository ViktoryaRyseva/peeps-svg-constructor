import { fragmentId } from './fragment';
/** Static SVG processing shared by editor, extraction and export. */
export const SVG_NS = 'http://www.w3.org/2000/svg';
const allowedTags = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs', 'style', 'title', 'desc', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask']);
const shapes = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const paintProperties = ['color', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'display', 'visibility', 'clip-path', 'clip-rule', 'mask-image', 'mask-type', 'stop-color', 'stop-opacity', 'paint-order', 'shape-rendering', 'color-interpolation'];
const cssAllowed = new Set([...paintProperties, 'mask']);
const resourceAttributes = new Set(['fill', 'stroke', 'clip-path', 'mask', 'filter']);
const geometryAttributes = new Set(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset']);

export class SvgExtractionError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'SvgExtractionError'; }
}
function fail(code: string, message: string): never { throw new SvgExtractionError(code, message); }
export type Bounds = { x: number; y: number; width: number; height: number };
export type ExtractedComponent = { svg: string; bounds: Bounds; dependencyCount: number; selectedCount: number; warnings: string[] };
const all = (root: Element) => [root, ...root.querySelectorAll('*')];

function validateValue(value: string) {
  if (/\\|\/\*|@|var\(|env\(|expression\(/i.test(value)) fail('UNSUPPORTED_CSS', 'CSS-переменные, escapes и внешние выражения не поддерживаются.');
  for (const match of value.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi)) {
    if (!match[1].startsWith('#')) fail('EXTERNAL_RESOURCE', 'Внешние ресурсы SVG не поддерживаются.');
  }
  if (/url\(/i.test(value) && !/url\(\s*['"]?#[^'"\s)]+['"]?\s*\)/i.test(value)) fail('INVALID_REFERENCE', 'Некорректная SVG-ссылка.');
}
function validateDeclaration(style: CSSStyleDeclaration) {
  for (const property of style) {
    if (!cssAllowed.has(property)) fail('UNSUPPORTED_CSS', `CSS-свойство «${property}» пока не поддерживается.`);
    const value = style.getPropertyValue(property);
    validateValue(value);
    if (/stroke/.test(property) && /%|em|ex|rem|vw|vh/.test(value)) fail('RELATIVE_UNITS', 'Относительные размеры обводки пока не поддерживаются.');
  }
}
function validateStyle(text: string) {
  // Reject at-rules before parsing so a discarded @import cannot cause a request.
  if (/@|\\/.test(text)) fail('UNSUPPORTED_CSS', 'CSS at-rules и escapes пока не поддерживаются.');
  const sheet = new CSSStyleSheet(); sheet.replaceSync(text);
  for (const rule of sheet.cssRules) {
    if (!(rule instanceof CSSStyleRule) || /:|\[|\]|\|/.test(rule.selectorText) || rule.cssRules.length) fail('UNSUPPORTED_CSS', 'Поддерживаются только статические CSS-селекторы без псевдоклассов и вложенных правил.');
    validateDeclaration(rule.style);
  }
}

/** Validate before insertion into the live DOM. This is an explicit subset, not a universal SVG sanitizer. */
export function parseSvg(text: string): SVGSVGElement {
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text)) fail('UNSAFE_XML', 'DTD, XML-сущности и внешние таблицы стилей не поддерживаются.');
  const document = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (document.querySelector('parsererror')) fail('INVALID_XML', 'Файл содержит некорректный XML.');
  const root = document.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== SVG_NS) fail('INVALID_SVG', 'Ожидается корневой SVG в пространстве имён SVG.');
  const vb = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (!vb || vb.length !== 4 || !vb.every(Number.isFinite) || vb[2] <= 0 || vb[3] <= 0) fail('INVALID_VIEWBOX', 'Нужен конечный viewBox с положительной шириной и высотой.');
  for (const element of all(root)) {
    if (element.namespaceURI !== SVG_NS || !allowedTags.has(element.localName)) fail('UNSUPPORTED_ELEMENT', `Элемент <${element.localName}> пока не поддерживается.`);
    if (element !== root && element.localName === 'svg') {
      const nested = element.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
      if (!nested || nested.length !== 4 || !nested.every(Number.isFinite) || nested[2] <= 0 || nested[3] <= 0) fail('NESTED_VIEWPORT', 'Вложенному SVG нужен конечный viewBox.');
      for (const key of ['x', 'y', 'width', 'height']) {
        const value = element.getAttribute(key) ?? (key === 'x' || key === 'y' ? '0' : '');
        if (!value.trim() || !Number.isFinite(Number(value)) || /%|[a-df-z]/i.test(value) || (key === 'width' || key === 'height') && Number(value) <= 0) fail('NESTED_VIEWPORT', 'Вложенному SVG нужны числовые x/y/width/height без относительных единиц.');
      }
    }
    if (element === root && element.hasAttribute('transform')) fail('ROOT_TRANSFORM', 'Transform корневого SVG пока не поддерживается.');
    if (element.localName === 'style') validateStyle(element.textContent ?? '');
    for (const attribute of element.attributes) {
      const { localName: name, value } = attribute;
      if (name === 'transform-origin') fail('UNSUPPORTED_TRANSFORM_ORIGIN', 'Выделение SVG с transform-origin пока недоступно: центр поворота зависит от исходного холста. Преобразуйте поворот в обычную матрицу.');
      if (/^on/i.test(name) || name === 'base') fail('UNSAFE_ATTRIBUTE', `Атрибут «${name}» не поддерживается.`);
      if (name === 'style') {
        validateValue(value);
        const probe = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        probe.setAttribute('style', value); validateDeclaration(probe.style);
      }
      if (name === 'href' && (!value.startsWith('#') || !['linearGradient', 'radialGradient'].includes(element.localName))) fail('UNSUPPORTED_REFERENCE', 'Поддерживаются только локальные href градиентов; use пока не поддерживается.');
      if (name === 'filter' && value !== 'none' || name.startsWith('marker') && value !== 'none' || name === 'vector-effect' && value !== 'none') fail('UNSUPPORTED_EFFECT', 'Фильтры, маркеры и non-scaling-stroke пока не поддерживаются.');
      if (resourceAttributes.has(name)) validateValue(value);
      if ((shapes.has(element.localName) && geometryAttributes.has(name) || name.startsWith('stroke-')) && /%|em|ex|rem|vw|vh/.test(value)) fail('RELATIVE_UNITS', 'Относительные размеры геометрии пока не поддерживаются.');
    }
  }
  return root as unknown as SVGSVGElement;
}

/** A separate shadow tree prevents application CSS from changing imported artwork. */
export function mountSvg(text: string, container?: HTMLElement) {
  const parsed = parseSvg(text);
  const host = document.createElement('div');
  if (!container) host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = ':host{all:initial;color:black}svg{display:block}';
  shadow.append(style);
  const svg = document.importNode(parsed, true);
  const vb = svg.viewBox.baseVal;
  svg.setAttribute('width', String(vb.width)); svg.setAttribute('height', String(vb.height));
  shadow.append(svg); (container ?? document.body).append(host);
  return { svg, host, dispose: () => host.remove() };
}

export function logicalObject(root: SVGSVGElement, target: Element | null): SVGGraphicsElement | null {
  for (let node = target; node && node !== root; node = node.parentElement) {
    if (root.contains(node) && node.getAttribute('data-component') === 'true' && node instanceof SVGGraphicsElement && !node.closest('defs,clipPath,mask')) return node;
  }
  return null;
}
export function selectObject(root: SVGSVGElement, previous: SVGGraphicsElement[], target: Element | null, shift = false): SVGGraphicsElement[] {
  const object = logicalObject(root, target);
  if (!object) return shift ? previous : [];
  return !shift ? [object] : previous.includes(object) ? previous.filter(node => node !== object) : [...previous, object];
}
export function selectBySelector(root: SVGSVGElement, selector: string): SVGGraphicsElement {
  let matches: NodeListOf<Element>;
  try { matches = root.querySelectorAll(selector); } catch { return fail('INVALID_SELECTOR', 'Некорректный селектор выбора.'); }
  if (matches.length !== 1) fail('AMBIGUOUS_SELECTION', 'Селектор должен однозначно выбирать один объект.');
  const selected = logicalObject(root, matches[0]);
  if (!selected) fail('NOT_SELECTABLE', 'Узел не помечен как самостоятельный логический объект.');
  return selected;
}

function references(element: Element): string[] {
  const ids: string[] = [];
  for (const attribute of element.attributes) {
    if (attribute.localName === 'href' && attribute.value.startsWith('#')) ids.push(fragmentId(attribute.value.slice(1)));
    for (const match of attribute.value.matchAll(/url\(\s*['"]?#([^'"\s)]+)['"]?\s*\)/gi)) ids.push(fragmentId(match[1]));
  }
  return ids;
}
function localizeUrl(value: string): string {
  return value.replace(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi, (_, url: string) => {
    if (url.startsWith('#')) return `url(${url})`;
    const resolved = new URL(url, location.href), current = new URL(location.href);
    if (resolved.origin !== current.origin || resolved.pathname !== current.pathname || resolved.search !== current.search || !resolved.hash) fail('EXTERNAL_RESOURCE', 'Вычисленный стиль ссылается на внешний ресурс.');
    return `url(${resolved.hash})`;
  });
}
function frozenClone(source: Element, deep: boolean, register?: (source: Element, clone: Element) => void): Element {
  const clone = source.cloneNode(false) as SVGElement;
  clone.removeAttribute('class'); clone.removeAttribute('style');
  const computed = getComputedStyle(source);
  for (const property of paintProperties) {
    const value = localizeUrl(computed.getPropertyValue(property));
    if (value) {
      if (property === 'mask-image') clone.setAttribute('mask', value);
      else clone.style.setProperty(property, value);
    }
  }
  register?.(source, clone);
  if (deep) for (const child of source.children) {
    if (!['style', 'defs'].includes(child.localName)) clone.append(frozenClone(child, true, register));
  }
  return clone;
}

/** Freeze a complete viewport without cropping or changing resource coordinates.
 * Keeping defs in place and removing stylesheets isolates nested exported SVGs.
 */
export function freezeCompleteSvg(root: SVGSVGElement): SVGSVGElement {
  const cloneTree = (source: Element): Element => {
    const clone = frozenClone(source, false);
    if (['title', 'desc'].includes(source.localName)) clone.textContent = source.textContent;
    for (const child of source.children) if (child.localName !== 'style') clone.append(cloneTree(child));
    return clone;
  };
  return cloneTree(root) as SVGSVGElement;
}

export function measureSelection(root: SVGSVGElement, selected: SVGGraphicsElement[]): { bounds: Bounds; warnings: string[] } {
  if (!root.isConnected || root.ownerDocument !== document) fail('NOT_MOUNTED', 'Для getBBox исходник должен быть подключён к SVG DOM браузера.');
  const inverse = root.getScreenCTM()?.inverse();
  if (!inverse) fail('INVALID_GEOMETRY', 'Невозможно вычислить систему координат исходника.');
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const warnings = new Set<string>();
  for (const node of selected) for (const element of all(node)) {
    if (!shapes.has(element.localName) || !(element instanceof SVGGraphicsElement) || element.closest('defs,clipPath,mask')) continue;
    let visible = true;
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.display === 'none' || Number(style.opacity) === 0) visible = false;
      if (ancestor === root) break;
    }
    const style = getComputedStyle(element);
    if (!visible || style.visibility !== 'visible' || style.fill === 'none' && style.stroke === 'none') continue;
    const box = element.getBBox();
    let pad = 0;
    if (style.stroke !== 'none' && parseFloat(style.strokeWidth) > 0) {
      // Conservative bound: also covers square caps and acute miter joins.
      pad = parseFloat(style.strokeWidth) / 2 * Math.max(Math.SQRT2, style.strokeLinejoin === 'miter' ? parseFloat(style.strokeMiterlimit) : 1);
      warnings.add('Обводка: границы дополнены консервативным запасом, возможны прозрачные поля.');
    }
    const matrix = element.getScreenCTM();
    if (!matrix) fail('INVALID_GEOMETRY', 'Не удалось вычислить transform выбранного объекта.');
    const relative = inverse.multiply(matrix);
    for (const x of [box.x - pad, box.x + box.width + pad]) for (const y of [box.y - pad, box.y + box.height + pad]) {
      const point = new DOMPoint(x, y).matrixTransform(relative);
      minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) fail('EMPTY_GEOMETRY', 'Выбранный объект не содержит измеримой видимой геометрии.');
  if (selected.some(node => all(node).some(element => getComputedStyle(element).clipPath !== 'none' || getComputedStyle(element).maskImage !== 'none'))) warnings.add('Маска/клиппинг сохранены; границы рассчитаны по исходной геометрии без обрезки прозрачных полей.');
  return { bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, warnings: [...warnings] };
}

export function extractComponent(root: SVGSVGElement, selection: SVGGraphicsElement[]): ExtractedComponent {
  if (!selection.length) fail('EMPTY_SELECTION', 'Сначала выберите хотя бы один логический объект.');
  if (selection.some(node => !root.contains(node) || logicalObject(root, node) !== node)) fail('INVALID_SELECTION', 'Выбор содержит посторонний или неподготовленный объект.');
  const unique = [...new Set(selection)].filter(node => !selection.some(parent => parent !== node && parent.contains(node)));
  unique.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  // A pruned ancestor has a different object bounding box. Applying its original
  // bbox-relative mask/clip would silently change the result; reject that context.
  for (const selected of unique) for (let ancestor: Element | null = selected.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const computed = getComputedStyle(ancestor);
    for (const [value, attribute, defaultUnits] of [
      [computed.clipPath, 'clipPathUnits', 'userSpaceOnUse'],
      [computed.maskImage, 'maskUnits', 'objectBoundingBox'],
      [computed.maskImage, 'maskContentUnits', 'userSpaceOnUse'],
    ]) for (const match of localizeUrl(value).matchAll(/url\(#([^)]+)\)/g)) {
      const targets = all(root).filter(node => node.id === fragmentId(match[1]));
      if (targets.length === 1 && (targets[0].getAttribute(attribute) ?? defaultUnits) === 'objectBoundingBox') fail('CONTEXTUAL_EFFECT', 'Маска или clipPath родительской группы зависят от её полного bounding box. Выберите эту группу целиком.');
    }
    if (ancestor === root) break;
  }
  const { bounds, warnings } = measureSelection(root, unique);
  const viewport = root.viewBox.baseVal, epsilon = .0001;
  const rootClipping = bounds.x < viewport.x - epsilon || bounds.y < viewport.y - epsilon || bounds.x + bounds.width > viewport.x + viewport.width + epsilon || bounds.y + bounds.height > viewport.y + viewport.height + epsilon;
  if (rootClipping) {
    if (root.getAttribute('data-peeps-export') !== '1' && !root.querySelector('svg')) fail('ROOT_CLIPPING', 'Границы объекта выходят за исходный viewBox. Перенос исходного обрезания холстом пока не поддерживается.');
    const right=Math.min(bounds.x+bounds.width,viewport.x+viewport.width), bottom=Math.min(bounds.y+bounds.height,viewport.y+viewport.height);
    bounds.x=Math.max(bounds.x,viewport.x); bounds.y=Math.max(bounds.y,viewport.y);
    bounds.width=right-bounds.x; bounds.height=bottom-bounds.y;
    if(bounds.width<=0 || bounds.height<=0) fail('EMPTY_GEOMETRY','Выбранный объект полностью за пределами исходного холста.');
  }
  const output = document.createElementNS(SVG_NS, 'svg');
  output.setAttribute('width', String(bounds.width)); output.setAttribute('height', String(bounds.height));
  output.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
  const defs = document.createElementNS(SVG_NS, 'defs'); output.append(defs);
  const normalization = document.createElementNS(SVG_NS, 'g'); normalization.setAttribute('transform', `translate(${-bounds.x} ${-bounds.y})`); output.append(normalization);
  const clones = new Map<Element, Element>();
  function cloneTree(source: Element, complete: boolean): Element | null {
    if (['style', 'defs'].includes(source.localName)) return null;
    const included = complete || unique.includes(source as SVGGraphicsElement);
    if (!included && !unique.some(node => source.contains(node))) return null;
    let clone = frozenClone(source, false);
    if (source === root) {
      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('style', clone.getAttribute('style') ?? '');
      if (clone.hasAttribute('mask')) group.setAttribute('mask', clone.getAttribute('mask')!);
      clone = group;
    }
    clones.set(source, clone);
    for (const child of source.children) { const descendant = cloneTree(child, included); if (descendant) clone.append(descendant); }
    return clone;
  }
  normalization.append(cloneTree(root, false)!);
  const sourceIds = new Map<string, Element[]>();
  for (const node of all(root)) if (node.id) sourceIds.set(node.id, [...sourceIds.get(node.id) ?? [], node]);
  const resolving = new Set<Element>(), resolved = new Set<Element>();
  function resolveReference(id: string): Element {
    const candidates = sourceIds.get(id) ?? [];
    if (!candidates.length) fail('MISSING_DEPENDENCY', `Не найдена зависимость «${id}».`);
    if (candidates.length !== 1) fail('AMBIGUOUS_REFERENCE', `ID «${id}» повторяется: невозможно однозначно перенести ссылку.`);
    return candidates[0];
  }
  function registerDependency(source: Element): Element {
    if (resolving.has(source)) fail('CYCLIC_DEPENDENCY', `Циклическая SVG-зависимость «${source.id}».`);
    const existing = clones.get(source);
    if (resolved.has(source)) return existing!;
    resolving.add(source);
    if (!existing) {
      if (!['linearGradient', 'radialGradient', 'clipPath', 'mask'].includes(source.localName)) fail('UNSUPPORTED_DEPENDENCY', `Зависимость <${source.localName}> пока не поддерживается.`);
      const clone = frozenClone(source, true, (original, copy) => clones.set(original, copy)); defs.append(clone);
    }
    const clone = clones.get(source)!;
    for (const element of all(clone)) for (const id of references(element)) registerDependency(resolveReference(id));
    resolving.delete(source); resolved.add(source); return clone;
  }
  for (const element of all(normalization)) for (const id of references(element)) registerDependency(resolveReference(id));
  const prefix = `component-${crypto.randomUUID()}-`;
  const newIds = new Map<Element, string>();
  let index = 0;
  for (const [original, clone] of clones) if (original.id) { const id = `${prefix}${index++}`; clone.setAttribute('id', id); newIds.set(original, id); }
  for (const element of all(output)) for (const attribute of [...element.attributes]) {
    const lookup = (id: string) => newIds.get(resolveReference(fragmentId(id))) ?? fail('MISSING_DEPENDENCY', `Не перенесена зависимость «${id}».`);
    if (attribute.localName === 'href' && attribute.value.startsWith('#')) attribute.value = `#${lookup(attribute.value.slice(1))}`;
    else attribute.value = attribute.value.replace(/url\(\s*['"]?#([^'"\s)]+)['"]?\s*\)/gi, (_, id: string) => `url(#${lookup(id)})`);
  }
  if(rootClipping) {
    const clip=document.createElementNS(SVG_NS,'clipPath'),rect=document.createElementNS(SVG_NS,'rect');
    clip.id=`viewport-${crypto.randomUUID()}`;clip.setAttribute('clipPathUnits','userSpaceOnUse');
    for(const key of ['x','y','width','height'] as const) rect.setAttribute(key,String(viewport[key]));
    clip.append(rect);defs.append(clip);
    const group=document.createElementNS(SVG_NS,'g');group.setAttribute('clip-path',`url(#${clip.id})`);
    group.append(...normalization.children);normalization.append(group);
  }
  if (!defs.children.length) defs.remove();
  return { svg: new XMLSerializer().serializeToString(output), bounds, dependencyCount: defs.children.length, selectedCount: unique.length, warnings };
}
