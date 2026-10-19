import { expect, it } from 'vitest';
import { mountSvg } from '../../svg/base';
import { SelectionModel } from '../../svg/model';
import { extractSelection } from '../../svg/extract';
import { analyzePath } from '../../svg/topology';

const source = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">${body}</svg>`;
function setup(text: string) { const mounted = mountSvg(text); const model = new SelectionModel(mounted.svg); return { model, dispose: () => { model.dispose(); mounted.dispose(); } }; }

it.each([
  ['evenodd', 'M0 0h80v80h-80z M20 20h40v40h-40z M30 30h20v20h-20z', [[0, 1], [2]]],
  ['nonzero', 'M0 0h80v80h-80z M20 20v40h40v-40z M30 30h20v20h-20z', [[0, 1], [2]]],
  ['nonzero', 'M0 0h80v80h-80z M20 20h40v40h-40z M120 0h20v20h-20z', [[0, 1], [2]]],
  ['evenodd', 'M0 0h40v40h-40z M30 0h40v40h-40z M120 0h20v20h-20z', [[0, 1], [2]]],
])('preserves topology: %s / %s', (rule, d, expected) => {
  expect(analyzePath(d as string, rule as string).parts.map(value => value.indices)).toEqual(expected);
});
it('keeps ambiguous open / degenerate paths whole', () => {
  expect(analyzePath('M0 0h40v40 M80 0h20v20h-20z', 'evenodd').fallback).toContain('открытый');
});
it('caps analysis instead of multiplying work on pathological paths', () => {
  expect(analyzePath(Array.from({ length: 129 }, (_, i) => `M${i * 4} 0h2v2h-2z`).join(' '), 'evenodd').parts).toHaveLength(1);
});
it('retains a self-intersecting contour but exposes a disjoint detail', () => {
  const d = 'M0 0L40 40L0 40L30 0Z M100 0h20v20h-20z';
  expect(analyzePath(d, 'evenodd').parts.map(value => value.indices)).toEqual([[0], [1]]);
});
it('does not duplicate a shape when selected with one of its parts or its group', () => {
  const fixture = setup(source('<g id="group"><path id="p" d="M10 10h20v20h-20z M70 10h20v20h-20z"/></g>'));
  try {
    const { model } = fixture, whole = model.forSelector('#p'), part = model.forSelector('#p', 0), group = model.forSelector('#group');
    expect(model.normalize([part.id, whole.id])).toEqual([whole]);
    expect(model.normalize([part.id, group.id])).toEqual([group]);
    expect(() => extractSelection(model, ['foreign'])).toThrow();
    expect(() => extractSelection(model, [])).toThrow();
  } finally { fixture.dispose(); }
});
it('merges selected subpaths back into one painted layer in original order', () => {
  const fixture = setup(source('<path id="p" opacity=".5" d="M10 10h20v20h-20z M70 10h20v20h-20z"/>'));
  try {
    const { model } = fixture, before = new XMLSerializer().serializeToString(model.root);
    const result = extractSelection(model, [model.forSelector('#p', 1).id, model.forSelector('#p', 0).id]);
    const parsed = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
    expect(parsed.querySelectorAll('path')).toHaveLength(1);
    expect(parsed.querySelector('path')!.getAttribute('d')).toBe('M10 10H30V30H10z M70 10H90V30H70z');
    expect(new XMLSerializer().serializeToString(model.root)).toBe(before);
  } finally { fixture.dispose(); }
});
it('freezes original bbox paint before cropping to a detail', async () => {
  const fixture = setup(await (await fetch('/src/tests/assets/details/resources.svg')).text());
  try {
    const { model } = fixture;
    const result = extractSelection(model, [model.forSelector('#linear-detail', 1).id]);
    const parsed = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
    const frozen = parsed.querySelector('[gradientUnits="userSpaceOnUse"]');
    expect(frozen).not.toBeNull();
    expect(frozen!.getAttribute('gradientTransform')).toContain('matrix(');
    expect(result.bounds.width).toBeLessThan(50);
  } finally { fixture.dispose(); }
});
it('rejects ambiguous referenced IDs even when extracting a virtual part', () => {
  const fixture = setup(source('<defs><linearGradient id="a"/><linearGradient id="a"/></defs><path id="p" fill="url(#a)" d="M10 10h20v20h-20z M70 10h20v20h-20z"/>'));
  try { expect(() => extractSelection(fixture.model, [fixture.model.forSelector('#p', 0).id])).toThrow('повторяющийся ID'); }
  finally { fixture.dispose(); }
});
it('rejects viewport-dependent gradient percentages instead of silently changing colors', () => {
  const fixture = setup(source('<defs><linearGradient id="g" gradientUnits="userSpaceOnUse"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><path id="p" fill="url(#g)" d="M10 10h20v20h-20z M70 10h20v20h-20z"/>'));
  try { expect(() => extractSelection(fixture.model, [fixture.model.forSelector('#p', 0).id])).toThrow('viewport'); }
  finally { fixture.dispose(); }
});
