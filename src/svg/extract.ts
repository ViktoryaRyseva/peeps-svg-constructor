import { extractComponent, mountSvg, SvgExtractionError, type ExtractedComponent } from './base';
import type { SelectionModel } from './model';
import { freezeResourceCoordinates } from './resources';

export interface ExtractionV2 extends ExtractedComponent { extractionMs: number; detailCount: number }

/** Materialize only a disposable copy. Neither rendered SVG nor stored source is changed. */
export function extractSelection(model: SelectionModel, ids: string[]): ExtractionV2 {
  const started = performance.now();
  const selected = model.normalize(ids);
  if (!selected.length) throw new SvgExtractionError('EMPTY_SELECTION', 'Выберите объект или деталь.');
  const working = mountSvg(new XMLSerializer().serializeToString(model.root));
  try {
    const nodes = [working.svg, ...working.svg.querySelectorAll('*')];
    const targets = new Map<SVGGraphicsElement, Set<number> | null>();
    for (const candidate of selected) {
      const node = nodes[candidate.ordinal] as SVGGraphicsElement;
      if (candidate.kind !== 'part') targets.set(node, null);
      else {
        const indices = targets.get(node) ?? new Set<number>();
        candidate.indices!.forEach(index => indices.add(index)); targets.set(node, indices);
      }
    }
    freezeResourceCoordinates(working.svg, [...targets.keys()]);
    for (const [node, indices] of targets) {
      if (indices) {
        const source = model.elements[nodes.indexOf(node)] as SVGPathElement;
        const analysis = model.analyses.get(source)!;
        node.setAttribute('d', [...indices].sort((a, b) => a - b).map(index => analysis.subpaths[index]).join(' '));
      }
      node.setAttribute('data-component', 'true');
    }
    const result = extractComponent(working.svg, [...targets.keys()]);
    const warnings = selected.flatMap(candidate => candidate.kind === 'shape' && model.analyses.get(candidate.node as SVGPathElement)?.fallback ? [model.analyses.get(candidate.node as SVGPathElement)!.fallback!] : []);
    return { ...result, warnings: [...new Set([...result.warnings, ...warnings])], selectedCount: selected.length, detailCount: selected.filter(value => value.kind === 'part').length, extractionMs: performance.now() - started };
  } finally { working.dispose(); }
}
