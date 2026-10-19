import { SVG_NS, SvgExtractionError, type Bounds } from './base';
import { analyzePath, type PathAnalysis } from './topology';

export interface Candidate {
  id: string;
  kind: 'group' | 'shape' | 'part';
  label: string;
  node: SVGGraphicsElement;
  ordinal: number;
  indices?: number[];
  d?: string;
  holes?: number;
  probe?: SVGPathElement;
}
const shapes = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const inDefs = (node: Element) => !!node.closest('defs,clipPath,mask,linearGradient,radialGradient');
const covers = (parent: Candidate, child: Candidate) =>
  parent.node !== child.node && parent.kind === 'group' && parent.node.contains(child.node) ||
  parent.node === child.node && parent.kind === 'shape' && child.kind === 'part';
export class SelectionModel {
  readonly candidates: Candidate[] = [];
  readonly analyses = new Map<SVGPathElement, PathAnalysis>();
  readonly elements: Element[];
  readonly byNode = new Map<Element, Candidate>();
  readonly partsByNode = new Map<Element, Candidate[]>();
  private byId = new Map<string, Candidate>();
  readonly stats: { preparationMs: number; parts: number; shapes: number; fallbacks: number };
  private probeHost: HTMLDivElement;

  constructor(readonly root: SVGSVGElement) {
    const started = performance.now();
    this.elements = [root, ...root.querySelectorAll('*')];
    this.probeHost = document.createElement('div');
    this.probeHost.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
    const probeRoot = document.createElementNS(SVG_NS, 'svg');
    this.probeHost.attachShadow({ mode: 'open' }).append(probeRoot);
    document.body.append(this.probeHost);
    try {
    let fallbackCount = 0;
    this.elements.forEach((node, ordinal) => {
      if (!(node instanceof SVGGraphicsElement) || inDefs(node) || node === root) return;
      if (node.localName !== 'g' && !shapes.has(node.localName)) return;
      const entry: Candidate = { id: `n${ordinal}`, kind: node.localName === 'g' ? 'group' : 'shape', label: `${node.localName}: ${node.id || ordinal}`, node, ordinal };
      this.candidates.push(entry); this.byNode.set(node, entry);
      if (node instanceof SVGPathElement && node.getAttribute('d')) {
        const analysis = analyzePath(node.getAttribute('d')!, getComputedStyle(node).fillRule);
        this.analyses.set(node, analysis);
        if (analysis.fallback) fallbackCount++;
        if (analysis.parts.length > 1) for (const part of analysis.parts) {
          const probe = document.createElementNS(SVG_NS, 'path');
          probe.setAttribute('d', part.d);
          for (const property of ['fill-rule', 'stroke-width', 'stroke-linecap', 'stroke-linejoin']) probe.style.setProperty(property, getComputedStyle(node).getPropertyValue(property));
          probeRoot.append(probe);
          this.candidates.push({ ...entry, id: `${entry.id}:p${part.indices.join('-')}`, kind: 'part', label: `${node.parentElement?.id || node.id || 'path'} · деталь ${part.indices[0] + 1}${part.holes ? ` (отверстий: ${part.holes})` : ''}`, indices: part.indices, d: part.d, holes: part.holes, probe });
        }
      }
    });
    for (const candidate of this.candidates) {
      this.byId.set(candidate.id, candidate);
      if (candidate.kind === 'part') this.partsByNode.set(candidate.node, [...this.partsByNode.get(candidate.node) ?? [], candidate]);
    }
    this.stats = { preparationMs: performance.now() - started, parts: this.candidates.filter(value => value.kind === 'part').length, shapes: this.candidates.filter(value => value.kind === 'shape').length, fallbacks: fallbackCount };
    } catch (reason) { this.probeHost.remove(); throw reason; }
  }
  dispose() { this.probeHost.remove(); }
  candidate(id: string) { return this.byId.get(id) ?? null; }
  forSelector(selector: string, partIndex?: number): Candidate {
    const nodes = this.root.querySelectorAll(selector);
    if (nodes.length !== 1) throw new SvgExtractionError('AMBIGUOUS_SELECTION', 'Селектор должен выбрать ровно один узел.');
    const node = nodes[0];
    const candidate = partIndex === undefined ? this.byNode.get(node) : this.candidates.find(value => value.node === node && value.kind === 'part' && value.indices?.[0] === partIndex);
    if (!candidate) throw new SvgExtractionError('PART_NOT_AVAILABLE', 'Для этого узла нет запрошенной самостоятельной детали.');
    return candidate;
  }
  choose(target: Element | null, clientX: number, clientY: number, deep = false): Candidate | null {
    let shape: Element | null = target;
    while (shape && !shapes.has(shape.localName) && shape !== this.root) shape = shape.parentElement;
    if (!shape || shape === this.root || !this.byNode.has(shape)) return null;
    if (deep) {
      if (shape instanceof SVGPathElement) {
        const matrix = shape.getScreenCTM();
        if (matrix) {
          const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
          const style = getComputedStyle(shape);
          const part = this.partsByNode.get(shape)?.find(value => value.probe && (style.fill !== 'none' && value.probe.isPointInFill(point) || style.stroke !== 'none' && value.probe.isPointInStroke(point)));
          if (part) return part;
        }
      }
      return this.byNode.get(shape)!;
    }
    for (let ancestor: Element | null = shape.parentElement; ancestor && ancestor !== this.root; ancestor = ancestor.parentElement) {
      if (ancestor.localName === 'g' && this.byNode.has(ancestor)) return this.byNode.get(ancestor)!;
    }
    return this.byNode.get(shape)!;
  }
  normalize(ids: string[]): Candidate[] {
    const selected = [...new Set(ids)].map(id => this.candidate(id));
    if (selected.some(value => !value)) throw new SvgExtractionError('INVALID_SELECTION', 'Выбор не относится к этому исходнику.');
    return (selected as Candidate[]).filter(value => !selected.some(parent => parent && parent !== value && covers(parent, value)));
  }
  toggle(previous: string[], candidate: Candidate | null, shift: boolean): string[] {
    if (!candidate) return shift ? previous : [];
    // A deliberate deep Shift-pick refines a selected ancestor, rather than
    // letting normalization silently swallow the requested detail. Unrelated
    // selections remain selected; subsequent Shift-picks add/remove details.
    const base = shift ? this.normalize(previous).filter(value => !covers(value, candidate)).map(value => value.id) : [];
    const ids = !shift ? [candidate.id] : base.includes(candidate.id) ? base.filter(id => id !== candidate.id) : [...base, candidate.id];
    return this.normalize(ids).map(value => value.id);
  }
  frame(ids: string[]): Bounds | null {
    const selected = this.normalize(ids), inverse = this.root.getScreenCTM()?.inverse();
    if (!selected.length || !inverse) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const entry of selected) {
      const box = entry.probe?.getBBox() ?? entry.node.getBBox();
      const matrix = entry.node.getScreenCTM(); if (!matrix) continue;
      const relative = inverse.multiply(matrix);
      for (const x of [box.x, box.x + box.width]) for (const y of [box.y, box.y + box.height]) {
        const p = new DOMPoint(x, y).matrixTransform(relative);
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
}
