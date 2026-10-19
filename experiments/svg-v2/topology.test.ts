import { expect, it } from 'vitest';
import { analyzePath, absoluteSubpaths } from './topology';
import { mountSvg } from '../svg/extract';
import { SelectionModel } from './model';

it('parses relative commands and preserves native arcs', () => {
  const parts = absoluteSubpaths('m10 10h20v20h-20z m50 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0z');
  expect(parts).toHaveLength(2); expect(parts[1]).toContain('M60'); expect(parts[1]).toContain('A');
});
it('keeps donut holes, exposes disconnected regions', () => {
  const result = analyzePath('M0 0h40v40h-40z M10 10h20v20h-20z M60 0h20v20h-20z', 'evenodd');
  expect(result.parts).toHaveLength(2); expect(result.parts[0].indices).toEqual([0, 1]); expect(result.parts[0].holes).toBe(1);
});
it('reports real face details without modifying the source', async () => {
  for (const name of ['peep-sitting-7.svg', 'peep-sitting-10.svg', 'peep-standing-24.svg']) {
    const mounted = mountSvg(await (await fetch(`/demo/${name}`)).text());
    const before = new XMLSerializer().serializeToString(mounted.svg);
    const model = new SelectionModel(mounted.svg);
    const face = model.candidates.filter(value => value.kind === 'part' && value.node.parentElement?.id.startsWith('face/'));
    expect(face).toHaveLength(6);
    if (name.includes('sitting-10')) expect(face[2].holes).toBe(8);
    expect(new XMLSerializer().serializeToString(mounted.svg)).toBe(before);
    model.dispose(); mounted.dispose();
  }
});
