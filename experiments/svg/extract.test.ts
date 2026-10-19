import { afterEach, describe, expect, it } from 'vitest';
import { extractComponent, mountSvg, parseSvg, selectBySelector, selectObject, SvgExtractionError, type ExtractedComponent } from './extract';

const mounted: ReturnType<typeof mountSvg>[] = [];
const wrap = (body: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" ${attrs}>${body}</svg>`;
const rectangle = '<g data-component="true" id="object"><rect x="10" y="20" width="50" height="30"/></g>';
function mount(text: string) { const item = mountSvg(text); mounted.push(item); return item.svg; }
function extract(text: string, selector = '#object'): ExtractedComponent {
  const svg = mount(text); return extractComponent(svg, [selectBySelector(svg, selector)]);
}
async function fixture(name: string) {
  const response = await fetch(`/experiments/${name}`);
  if (!response.ok) throw new Error(`Fixture ${name}: ${response.status}`);
  return response.text();
}
afterEach(() => { mounted.splice(0).forEach(item => item.dispose()); });

describe('Parsing and deliberate rejection before live DOM insertion', () => {
  it('uses native XML parser, rejects malformed XML', () => {
    expect(() => parseSvg('<svg><g></svg>')).toThrow(SvgExtractionError);
    expect(() => parseSvg('<svg/>')).toThrow('пространстве имён');
  });
  it.each([
    ['script', '<script>globalThis.invalid=true</script>', 'UNSUPPORTED_ELEMENT'],
    ['image', '<image href="data:image/png;base64,x"/>', 'UNSUPPORTED_ELEMENT'],
    ['foreignObject', '<foreignObject/>', 'UNSUPPORTED_ELEMENT'],
    ['use', '<use href="#object"/>', 'UNSUPPORTED_ELEMENT'],
    ['filter', '<g filter="url(#f)"/>', 'UNSUPPORTED_EFFECT'],
    ['animation', '<animate/>', 'UNSUPPORTED_ELEMENT'],
    ['event', '<rect onload="alert(1)"/>', 'UNSAFE_ATTRIBUTE'],
    ['external paint', '<rect fill="url(https://example.invalid/paint.svg#x)"/>', 'EXTERNAL_RESOURCE'],
    ['css import', '<style>@import "https://example.invalid/style.css";</style>', 'UNSUPPORTED_CSS'],
    ['css transform', '<style>.a { transform: rotate(20deg) }</style>', 'UNSUPPORTED_CSS'],
    ['css variable', '<g style="fill:var(--paint)"/>', 'UNSUPPORTED_CSS'],
    ['pseudo selector', '<style>rect:hover { fill:red }</style>', 'UNSUPPORTED_CSS'],
    ['percent geometry', '<rect width="80%" height="40"/>', 'RELATIVE_UNITS'],
    ['nested viewport', '<svg viewBox="0 0 20 20"/>', 'NESTED_VIEWPORT'],
  ])('rejects %s with a stable error code', (_, body, code) => {
    try { parseSvg(wrap(body)); throw new Error('Expected rejection'); }
    catch (error) { expect(error).toBeInstanceOf(SvgExtractionError); expect((error as SvgExtractionError).code).toBe(code); }
  });
  it('rejects DTD, missing/zero/invalid viewBox', () => {
    expect(() => parseSvg('<!DOCTYPE svg>' + wrap(rectangle))).toThrow('DTD');
    for (const box of ['', '0 0 0 20', '0 0 nope 10']) expect(() => parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}"/>`)).toThrow('viewBox');
  });
});

describe('Logical selection', () => {
  it('finds nearest marked group, supports Shift toggle and background', () => {
    const root = mount(wrap(rectangle + '<g data-component="true" id="other"><circle r="5"/></g>'));
    const first = selectBySelector(root, '#object rect'), other = selectBySelector(root, '#other circle');
    let selected = selectObject(root, [], first.querySelector('rect'));
    expect(selected).toEqual([first]);
    selected = selectObject(root, selected, other, true); expect(selected).toEqual([first, other]);
    selected = selectObject(root, selected, first, true); expect(selected).toEqual([other]);
    expect(selectObject(root, selected, root)).toEqual([]);
    expect(() => selectBySelector(root, 'g')).toThrow('однозначно');
    expect(() => selectBySelector(root, '[')).toThrow('селектор');
  });
  it('does not choose arbitrary unmarked path or definition', () => {
    const root = mount(wrap('<path d="M0 0h20v20z"/><defs><clipPath data-component="true" id="clip"><rect width="10" height="10"/></clipPath></defs>'));
    expect(() => selectBySelector(root, 'path')).toThrow('не помечен');
    expect(selectObject(root, [], root.querySelector('#clip'))).toEqual([]);
  });
  it('normalizes ancestor/descendant selections without duplicate graphics', () => {
    const root = mount(wrap('<g id="parent" data-component="true">' + rectangle + '</g>'));
    const result = extractComponent(root, [selectBySelector(root, '#object'), selectBySelector(root, '#parent')]);
    expect(result.selectedCount).toBe(1); expect(parseSvg(result.svg).querySelectorAll('rect')).toHaveLength(1);
  });
  it('rejects empty selection, foreign node, detached measurement and empty geometry', () => {
    const root = mount(wrap(rectangle)), other = mount(wrap(rectangle));
    expect(() => extractComponent(root, [])).toThrow('выберите');
    expect(() => extractComponent(root, [selectBySelector(other, '#object')])).toThrow('посторонний');
    const detached = parseSvg(wrap(rectangle));
    expect(() => extractComponent(detached, [selectBySelector(detached, '#object')])).toThrow('подключён');
    expect(() => extract(wrap('<g id="object" data-component="true"/>'))).toThrow('геометрии');
  });
});

describe('Geometry and styling in actual Chrome SVG DOM', () => {
  it('gets object-sized viewBox and preserves the original source DOM', () => {
    const root = mount(wrap(rectangle)), before = new XMLSerializer().serializeToString(root);
    const result = extractComponent(root, [selectBySelector(root, '#object')]);
    expect(result.bounds).toEqual({ x: 10, y: 20, width: 50, height: 30 });
    expect(parseSvg(result.svg).getAttribute('viewBox')).toBe('0 0 50 30');
    expect(new XMLSerializer().serializeToString(root)).toBe(before);
    const isolated = mount(result.svg);
    expect(isolated.getBBox().width).toBe(50);
  });
  it('retains nested transforms and root viewBox coordinates', () => {
    const result = extract(wrap(`<g transform="translate(100 40) scale(2 3)">${rectangle}</g>`));
    expect(result.bounds).toEqual({ x: 120, y: 100, width: 100, height: 90 });
    const root = mount(result.svg), box = root.getBBox();
    expect(box.x).toBeCloseTo(0); expect(box.y).toBeCloseTo(0);
    expect(box.width).toBeCloseTo(100); expect(box.height).toBeCloseTo(90);
  });
  it('bakes inherited CSS, currentColor and group opacity without leaking styles', () => {
    const result = extract(wrap('<style>.theme .paint { fill:currentColor }</style><g class="theme" color="#2468ab" opacity=".4"><g id="object" data-component="true"><rect class="paint" width="50" height="30"/></g></g>'));
    const root = mount(result.svg), shape = root.querySelector('rect')!;
    expect(getComputedStyle(shape).fill).toBe('rgb(36, 104, 171)');
    expect(root.querySelector('style')).toBeNull();
    expect([...root.querySelectorAll('g')].some(node => getComputedStyle(node).opacity === '0.4')).toBe(true);
  });
  it('preserves source paint order independently of click order', () => {
    const root = mount(wrap('<g id="a" data-component="true"><rect width="30" height="30" fill="red"/></g><g id="b" data-component="true"><rect width="40" height="40" fill="blue"/></g>'));
    const result = extractComponent(root, [selectBySelector(root, '#b'), selectBySelector(root, '#a')]);
    const output = mount(result.svg), rectangles = output.querySelectorAll('rect');
    expect(getComputedStyle(rectangles[0]).fill).toBe('rgb(255, 0, 0)');
    expect(getComputedStyle(rectangles[1]).fill).toBe('rgb(0, 0, 255)');
  });
  it('rejects partial extraction below bbox-dependent ancestor effects', () => {
    const text = wrap('<defs><clipPath id="clip" clipPathUnits="objectBoundingBox"><rect width=".5" height="1"/></clipPath></defs><g clip-path="url(#clip)">' + rectangle + '<rect x="200" width="30" height="30"/></g>');
    expect(() => extract(text)).toThrow('Выберите эту группу целиком');
  });
  it('rejects geometry requiring preservation of original root viewport clipping', () => {
    expect(() => extract(wrap('<g id="object" data-component="true"><rect x="-20" width="40" height="40"/></g>'))).toThrow('исходный viewBox');
  });
  it('includes conservative stroke bounds with miter joins, square caps and rotation', async () => {
    const result = extract(await fixture('stroke.svg'), '#stroke-object');
    expect(result.warnings.join(' ')).toContain('Обводка');
    expect(result.bounds.width).toBeGreaterThan(150);
    expect(parseSvg(result.svg).querySelector('path')?.getAttribute('d')).toBe('M0 60 25 0 50 60');
  });
});

describe('Dependency closure and ID isolation', () => {
  it('copies transitive gradients, clipPath and mask, excluding unused definitions', async () => {
    const result = extract(await fixture('dependencies.svg'), '#gradient-object'), output = parseSvg(result.svg);
    expect(result.bounds).toEqual({ x: 80, y: 65, width: 100, height: 80 });
    expect(result.dependencyCount).toBe(4);
    expect(output.querySelectorAll('linearGradient')).toHaveLength(2);
    expect(output.querySelectorAll('clipPath')).toHaveLength(1);
    expect(output.querySelectorAll('mask')).toHaveLength(1);
    expect(output.querySelectorAll('radialGradient')).toHaveLength(0);
    expect(output.querySelector('style')).toBeNull();
    expect(result.svg).not.toContain('pink');
    const isolated = mount(result.svg);
    expect(getComputedStyle(isolated.querySelector('stop')!).stopColor).toBe('rgb(237, 148, 74)');
    const ids = new Set([...output.querySelectorAll('[id]')].map(node => node.id));
    for (const match of result.svg.matchAll(/(?:url\(#|href="#)([^)"\s]+)/g)) expect(ids.has(match[1])).toBe(true);
  });
  it('supports local legacy xlink gradient references', () => {
    const result = extract(wrap('<defs><linearGradient id="base"><stop offset="0" stop-color="red"/></linearGradient><linearGradient xmlns:xlink="http://www.w3.org/1999/xlink" id="grad" xlink:href="#base"/></defs><g id="object" data-component="true"><rect width="10" height="20" fill="url(#grad)"/></g>'));
    expect(result.dependencyCount).toBe(2); expect(parseSvg(result.svg).querySelectorAll('linearGradient')).toHaveLength(2);
  });
  it('isolates UUIDs on repeated extraction and remains usable without source', () => {
    const root = mount(wrap(rectangle));
    const first = extractComponent(root, [selectBySelector(root, '#object')]);
    const second = extractComponent(root, [selectBySelector(root, '#object')]);
    const a = parseSvg(first.svg), b = parseSvg(second.svg);
    expect(a.querySelector('[id]')!.id).not.toBe(b.querySelector('[id]')!.id);
    expect(first.bounds).toEqual(second.bounds);
    mounted.splice(0).forEach(item => item.dispose());
    const result = mount(first.svg); expect(result.getBBox().width).toBe(50);
  });
  it('renames unreferenced duplicate IDs individually', () => {
    const result = extract(wrap('<g id="object" data-component="true"><rect id="duplicate" width="20" height="20"/><rect id="duplicate" x="30" width="20" height="20"/></g>'));
    const ids = [...parseSvg(result.svg).querySelectorAll('[id]')].map(node => node.id);
    expect(ids.length).toBe(3); expect(new Set(ids).size).toBe(3);
  });
  it('rejects a reference to a duplicate ID', () => {
    expect(() => extract(wrap('<defs><linearGradient id="dup"/><linearGradient id="dup"/></defs><g id="object" data-component="true"><rect width="10" height="10" fill="url(#dup)"/></g>'))).toThrow('повторяется');
  });
  it('rejects missing and cyclic dependency rather than saving broken output', () => {
    expect(() => extract(wrap('<g id="object" data-component="true"><rect width="20" height="20" fill="url(#missing)"/></g>'))).toThrow('Не найдена');
    expect(() => extract(wrap('<defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs><g id="object" data-component="true"><rect width="20" height="20" fill="url(#a)"/></g>'))).toThrow('Циклическая');
  });
});

describe('Three real Peep files', () => {
  it.each(['peep-sitting-7.svg', 'peep-sitting-10.svg', 'peep-standing-24.svg'])('extracts Head and pose from %s', async name => {
    const root = mount(await fixture(name));
    const head = extractComponent(root, [selectBySelector(root, '[id="Head"]')]);
    const pose = extractComponent(root, [selectBySelector(root, '[id^="pose/"]')]);
    expect(head.bounds.width).toBeGreaterThan(30); expect(head.bounds.height).toBeGreaterThan(30);
    expect(head.bounds.height).toBeLessThan(root.viewBox.baseVal.height);
    expect(pose.bounds.height).toBeGreaterThan(head.bounds.height);
    expect(parseSvg(head.svg).querySelectorAll('path')).toHaveLength(3);
    const ids = [...parseSvg(head.svg).querySelectorAll('[id]')].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    const isolated = mount(head.svg);
    expect(isolated.getBBox().width).toBeCloseTo(head.bounds.width, 3);
  });
});
