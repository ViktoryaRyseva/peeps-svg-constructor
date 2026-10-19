import { forwardRef, useImperativeHandle, useLayoutEffect, useEffect, useRef } from 'react';
import { mountSvg, SVG_NS } from '../svg/base';
import { SelectionModel } from '../svg/model';
import { extractSelection, type ExtractionV2 } from '../svg/extract';
import s from '../App.module.css';

export interface SourceCanvasHandle { extract: (ids: string[]) => ExtractionV2 }
export interface SourceStatus { state: 'loading' | 'ready' | 'error'; message?: string }
interface Props {
  svgContent: string;
  selected: string[];
  onSelect: (ids: string[]) => void;
  onStatus: (status: SourceStatus) => void;
}

/** The React host owns presentation; imported artwork stays in its own shadow tree.
 * The same processor and native hit testing are exercised by browser fixtures.
 */
const SourceCanvas = forwardRef<SourceCanvasHandle, Props>(function SourceCanvas({ svgContent, selected, onSelect, onStatus }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const model = useRef<SelectionModel | null>(null), overlay = useRef<SVGSVGElement | null>(null);
  const currentSelection = useRef(selected); currentSelection.current = selected;
  useImperativeHandle(ref, () => ({ extract: ids => {
    if (!model.current) throw new Error('Исходник ещё не готов к выделению.');
    return extractSelection(model.current, ids);
  } }), []);

  useEffect(() => {
    onStatus({ state: 'loading' });
    let mounted: ReturnType<typeof mountSvg> | undefined, selection: SelectionModel | undefined;
    let cancelled = false, frame = 0;
    const prepare = () => {
    if (cancelled) return;
    try {
      mounted = mountSvg(svgContent, container.current!);
      const style = document.createElement('style');
      style.textContent = ':host{display:block;position:relative;width:100%;height:100%;user-select:none}:host>svg{width:100%;height:100%}#selection-overlay{position:absolute;inset:0;pointer-events:none;overflow:visible}#selection-overlay rect{fill:none;stroke:var(--selection-accent,#4d8dff);stroke-width:1.5;vector-effect:non-scaling-stroke}';
      mounted.host.shadowRoot!.append(style);
      selection = new SelectionModel(mounted.svg); model.current = selection;
      const outline = document.createElementNS(SVG_NS, 'svg'); outline.id = 'selection-overlay';
      outline.setAttribute('viewBox', mounted.svg.getAttribute('viewBox')!);
      outline.setAttribute('preserveAspectRatio', mounted.svg.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet');
      outline.setAttribute('aria-hidden', 'true');
      mounted.host.shadowRoot!.append(outline); overlay.current = outline;
      const change = (ids: string[]) => { currentSelection.current = ids; onSelect(ids); };
      mounted.svg.addEventListener('click', event => {
        event.stopPropagation();
        if (event.detail > 1 && !event.shiftKey) return;
        const target = selection!.choose(event.target as Element, event.clientX, event.clientY, event.shiftKey);
        change(selection!.toggle(currentSelection.current, target, event.shiftKey));
      });
      mounted.svg.addEventListener('dblclick', event => {
        event.stopPropagation(); event.preventDefault();
        if (event.shiftKey) return;
        const target = selection!.choose(event.target as Element, event.clientX, event.clientY, true);
        change(target ? [target.id] : []);
      });
      onStatus({ state: 'ready' });
    } catch (reason) {
      selection?.dispose(); mounted?.dispose(); model.current = null; overlay.current = null;
      onSelect([]); onStatus({ state: 'error', message: (reason as Error).message });
    }
    };
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(prepare); });
    return () => { cancelled = true; cancelAnimationFrame(frame); model.current = null; overlay.current = null; selection?.dispose(); mounted?.dispose(); };
  }, [svgContent, onSelect, onStatus]);

  useLayoutEffect(() => {
    if (!model.current || !overlay.current) return;
    const frame = model.current.frame(selected); overlay.current.replaceChildren();
    if (frame) {
      const rect = document.createElementNS(SVG_NS, 'rect');
      for (const [key, value] of Object.entries(frame)) rect.setAttribute(key, String(value));
      overlay.current.append(rect);
    }
  }, [selected, svgContent]);

  return <div ref={container} className={s.sourceCanvas} data-testid="source-canvas" aria-label="Исходная SVG-иллюстрация" />;
});
export default SourceCanvas;
