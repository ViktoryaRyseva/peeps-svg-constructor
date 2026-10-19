import { extractComponent, mountSvg, selectBySelector, selectObject, type ExtractedComponent } from '../../svg/base';

const source = document.querySelector<HTMLElement>('#source')!;
const result = document.querySelector<HTMLElement>('#result')!;
const status = document.querySelector<HTMLElement>('#status')!;
const error = document.querySelector<HTMLElement>('#error')!;
const extractButton = document.querySelector<HTMLButtonElement>('#extract')!;
const downloadButton = document.querySelector<HTMLButtonElement>('#download')!;
const code = document.querySelector<HTMLTextAreaElement>('#code')!;
const fixture = document.querySelector<HTMLSelectElement>('#fixture')!;
let current: ReturnType<typeof mountSvg> | null = null;
let selection: SVGGraphicsElement[] = [];
let extracted: ExtractedComponent | null = null;
let imageUrl: string | null = null;
let originalText = '';

function updateSelection() {
  status.textContent = `Выбрано объектов: ${selection.length}${selection.length ? ' · ' + selection.map(node => node.id).join(', ') : ''}`;
  extractButton.disabled = !selection.length;
}
async function load(name: string) {
  error.textContent = ''; source.replaceChildren(); result.replaceChildren();
  current?.dispose(); selection = []; extracted = null;
  code.value = ''; downloadButton.disabled = true;
  if (imageUrl) { URL.revokeObjectURL(imageUrl); imageUrl = null; }
  const response = await fetch(`/src/tests/assets/groups/${name}`);
  if (!response.ok) throw new Error(`Файл недоступен: ${response.status}`);
  originalText = await response.text();
  current = mountSvg(originalText, source);
  // Presentation sizing only; SVG measurement remains in original user units.
  current.host.style.width = '100%';
  current.svg.style.maxWidth = '100%'; current.svg.style.height = 'auto';
  current.svg.addEventListener('click', event => {
    selection = selectObject(current!.svg, selection, event.target instanceof Element ? event.target : null, event.shiftKey);
    updateSelection();
  });
  updateSelection();
}
function run() {
  if (!current) throw new Error('Исходник не открыт.');
  extracted = extractComponent(current.svg, selection);
  code.value = extracted.svg;
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = URL.createObjectURL(new Blob([extracted.svg], { type: 'image/svg+xml' }));
  const image = new Image(); image.src = imageUrl; image.alt = 'Извлечённый SVG-компонент'; result.replaceChildren(image);
  const b = extracted.bounds;
  document.querySelector('#metrics')!.textContent = `viewBox: 0 0 ${b.width.toFixed(3)} ${b.height.toFixed(3)} · определений: ${extracted.dependencyCount}${extracted.warnings.length ? '\n' + extracted.warnings.join(' ') : ''}`;
  downloadButton.disabled = false; error.textContent = '';
  return extracted;
}
extractButton.addEventListener('click', () => { try { run(); } catch (reason) { error.textContent = (reason as Error).message; } });
fixture.addEventListener('change', () => { load(fixture.value).catch(reason => { error.textContent = reason.message; }); });
downloadButton.addEventListener('click', () => {
  if (!imageUrl) return;
  const link = document.createElement('a'); link.href = imageUrl; link.download = 'extracted-component.svg'; link.click();
});

// Test harness API: invokes the same module as the UI; no project/library integration.
declare global {
  interface Window {
    svgExtractionHarness: {
      load: typeof load;
      select: (selectors: string[]) => void;
      run: typeof run;
      sourceText: () => string;
      root: () => SVGSVGElement;
    };
  }
}
window.svgExtractionHarness = {
  load,
  select: selectors => { selection = selectors.map(selector => selectBySelector(current!.svg, selector)); updateSelection(); },
  run,
  sourceText: () => originalText,
  root: () => current!.svg,
};
load(fixture.value).catch(reason => { error.textContent = reason.message; });
