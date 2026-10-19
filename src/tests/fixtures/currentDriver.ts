import { mountSvg, SVG_NS } from '../../svg/base';
import { SelectionModel } from '../../svg/model';
import { extractSelection, type ExtractionV2 } from '../../svg/extract';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let mounted: ReturnType<typeof mountSvg> | null = null;
let model: SelectionModel | null = null, selected: string[] = [];
let original = '', result: ExtractionV2 | null = null, resultUrl = '', generation = 0;
let outline: SVGSVGElement;
function clearResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = ''; result = null; el('result').replaceChildren(); el<HTMLTextAreaElement>('code').value = '';
  el<HTMLButtonElement>('download').disabled = true; el('metrics').textContent = '';
}
function update() {
  if (!model) return;
  el('status').textContent = `Выбрано: ${selected.length}${selected.length ? ` · ${selected.map(id => model!.candidate(id)!.label).join('; ')}` : ''}\nСамостоятельных деталей: ${model.stats.parts} · Подготовка: ${model.stats.preparationMs.toFixed(1)} мс`;
  el<HTMLButtonElement>('extract').disabled = !selected.length;
  el<HTMLSelectElement>('candidate').value = selected.length === 1 ? selected[0] : '';
  outline.replaceChildren(); const frame = model.frame(selected);
  if (frame) { const rect = document.createElementNS(SVG_NS, 'rect'); for (const [key, value] of Object.entries(frame)) rect.setAttribute(key, String(value)); outline.append(rect); }
}
function select(ids: string[]) { selected = model!.normalize(ids).map(value => value.id); clearResult(); update(); }
function resize() {
  if (!mounted || !outline) return;
  const zoom = Number(el<HTMLSelectElement>('zoom').value), vb = mounted.svg.viewBox.baseVal;
  // Presentation belongs to the host, never to the original SVG DOM.
  mounted.host.style.zoom = String(zoom);
  outline.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
  outline.setAttribute('width', String(vb.width)); outline.setAttribute('height', String(vb.height));
}
async function load(name: string, text?: string) {
  const token = ++generation;
  const source = text ?? await (await fetch(`${name.startsWith('peep-') ? '/demo/' : '/experiments-v2/'}${name}`)).text();
  if (token !== generation) return;
  const next = mountSvg(source); let nextModel: SelectionModel;
  try { nextModel = new SelectionModel(next.svg); } catch (error) { next.dispose(); throw error; }
  model?.dispose(); mounted?.dispose(); clearResult();
  original = source; mounted = next; model = nextModel; selected = [];
  el('source').replaceChildren(next.host); next.host.style.cssText = 'position:relative;user-select:none;';
  outline = document.createElementNS(SVG_NS, 'svg'); outline.id = 'outline';
  const presentation = document.createElement('style');
  presentation.textContent = '#outline{position:absolute;inset:0;pointer-events:none;overflow:visible}#outline rect{fill:none;stroke:#668343;stroke-width:1.5;vector-effect:non-scaling-stroke}';
  next.host.shadowRoot!.append(presentation, outline); resize();
  const list = el<HTMLSelectElement>('candidate'); list.replaceChildren(new Option('Выберите…', ''));
  for (const candidate of model.candidates) list.add(new Option(`${candidate.kind === 'part' ? '↳ ' : ''}${candidate.label}`, candidate.id));
  next.svg.addEventListener('click', event => {
    // A native double click sends click(1), click(2), then dblclick. The second
    // plain click must not reset the final deep choice or enter a hidden scope.
    if (event.detail > 1 && !event.shiftKey) return;
    const candidate = model!.choose(event.target as Element, event.clientX, event.clientY, event.shiftKey);
    select(model!.toggle(selected, candidate, event.shiftKey));
  });
  next.svg.addEventListener('dblclick', event => {
    if (event.shiftKey) return;
    event.preventDefault();
    const candidate = model!.choose(event.target as Element, event.clientX, event.clientY, true);
    select(candidate ? [candidate.id] : []);
  });
  el('error').textContent = ''; update();
}
function run() {
  if (!model) throw new Error('Исходник не загружен.');
  const extracted = extractSelection(model, selected); clearResult(); result = extracted;
  resultUrl = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' }));
  const image = new Image(); image.alt = 'Извлечённая SVG-деталь'; image.src = resultUrl; el('result').append(image);
  image.style.cssText = 'width:100%;height:320px;object-fit:contain;display:block;';
  el<HTMLTextAreaElement>('code').value = result.svg; el<HTMLButtonElement>('download').disabled = false;
  el('metrics').textContent = `Деталей: ${result.detailCount} · Ресурсов: ${result.dependencyCount} · Извлечение: ${result.extractionMs.toFixed(1)} мс${result.warnings.length ? ` · ${result.warnings.join(' ')}` : ''}`;
  return result;
}
const guarded = (action: () => unknown) => { try { action(); el('error').textContent = ''; } catch (error) { el('error').textContent = (error as Error).message; } };
el('fixture').addEventListener('change', () => { void load(el<HTMLSelectElement>('fixture').value).catch(error => { el('error').textContent = error.message; }); });
el('zoom').addEventListener('change', resize);
el('candidate').addEventListener('change', () => select(el<HTMLSelectElement>('candidate').value ? [el<HTMLSelectElement>('candidate').value] : []));
el('extract').addEventListener('click', () => guarded(run));
el('clear').addEventListener('click', () => select([]));
el('download').addEventListener('click', () => { if (resultUrl) { const link = document.createElement('a'); link.href = resultUrl; link.download = 'extracted-detail.svg'; link.click(); } });
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !model) return;
  select([]);
});
export const api = {
  load, run, root: () => model!.root, model: () => model!, sourceText: () => original,
  select: (entries: { selector: string; part?: number }[]) => select(entries.map(entry => model!.forSelector(entry.selector, entry.part).id)),
  selection: () => selected.map(id => ({ id, kind: model!.candidate(id)!.kind })),
};
declare global { interface Window { svgExperimentV2: typeof api } }
window.svgExperimentV2 = api;
void load('peep-sitting-7.svg').catch(error => { el('error').textContent = error.message; });
