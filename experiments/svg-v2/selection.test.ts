import { expect, it } from 'vitest';
import { mountSvg } from '../svg/extract';
import { SelectionModel } from './model';

function setup() {
  const mounted = mountSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160"><g id="outer"><g id="one-child"><path id="p" d="M10 10h20v20h-20z M60 10h20v20h-20z"/></g></g><g id="other"><rect x="120" y="20" width="20" height="20"/></g></svg>');
  const model = new SelectionModel(mounted.svg);
  return { model, dispose: () => { model.dispose(); mounted.dispose(); } };
}

it('a plain click chooses the nearest real group even without semantic names or multiple children', () => {
  const fixture = setup();
  try {
    const { model } = fixture, path = model.forSelector('#p').node;
    expect(model.choose(path, 0, 0)).toBe(model.forSelector('#one-child'));
  } finally { fixture.dispose(); }
});

it('a deep pick uses local coordinates at nested transforms and returns the painted subpath', () => {
  const fixture = setup();
  try {
    const { model } = fixture, path = model.forSelector('#p').node;
    path.parentElement!.setAttribute('transform', 'translate(20 30) scale(1.5)');
    const point = new DOMPoint(65, 15).matrixTransform(path.getScreenCTM()!);
    expect(model.choose(path, point.x, point.y, true)).toBe(model.forSelector('#p', 1));
  } finally { fixture.dispose(); }
});

it('Shift refines selected groups or whole paths while preserving unrelated selections', () => {
  const fixture = setup();
  try {
    const { model } = fixture, group = model.forSelector('#outer'), path = model.forSelector('#p');
    const other = model.forSelector('#other'), first = model.forSelector('#p', 0), second = model.forSelector('#p', 1);
    expect(model.toggle([group.id, other.id], first, true)).toEqual([other.id, first.id]);
    expect(model.toggle([path.id, other.id], first, true)).toEqual([other.id, first.id]);
    const added = model.toggle([other.id, first.id], second, true);
    expect(added).toEqual([other.id, first.id, second.id]);
    expect(model.toggle(added, first, true)).toEqual([other.id, second.id]);
  } finally { fixture.dispose(); }
});

it('background Shift preserves selection and a plain background click clears it', () => {
  const fixture = setup();
  try {
    const { model } = fixture, part = model.forSelector('#p', 0);
    expect(model.choose(model.root, 0, 0, true)).toBeNull();
    expect(model.toggle([part.id], null, true)).toEqual([part.id]);
    expect(model.toggle([part.id], null, false)).toEqual([]);
  } finally { fixture.dispose(); }
});
