import { expect, it } from 'vitest';
import { exportComposition } from '../services/compositionExport';
import { mountSvg, parseSvg } from '../svg/base';
import { SelectionModel } from '../svg/model';
import { extractSelection } from '../svg/extract';
import type { InstanceView } from '../types/editor';

const component='<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 80"><defs><linearGradient id="цвет"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><mask id="mask" maskUnits="userSpaceOnUse" x="10" y="20" width="100" height="80"><rect x="10" y="20" width="100" height="80" fill="white"/><circle cx="35" cy="40" r="4" fill="black"/></mask><clipPath id="clip"><rect x="10" y="20" width="100" height="80"/></clipPath></defs><g mask="url(#mask)" clip-path="url(#clip)"><path fill="url(#цвет)" d="M20 30h30v20h-30z M70 60h20v15h-20z"/></g></svg>';
const item:InstanceView={id:'component',instanceId:'i',name:'Цвет.svg',image:'',svgContent:component,x:220,y:160,scaleX:1.3,scaleY:.8,rotation:37};
async function pixels(svg:string) {
 const image=new Image();image.src=`data:image/svg+xml,${encodeURIComponent(svg)}`;await image.decode();
 const canvas=document.createElement('canvas');canvas.width=200;canvas.height=200;const context=canvas.getContext('2d')!;context.drawImage(image,0,0,200,200);return context.getImageData(0,0,200,200).data;
}
it('export reimport preserves nested transforms, nonzero viewBox, gradients, masks and pixels',async()=>{
 const exported=exportComposition([item,{...item,instanceId:'two',x:420,rotation:-21}]);expect(()=>parseSvg(exported)).not.toThrow();
 const mounted=mountSvg(exported),model=new SelectionModel(mounted.svg);
 try {
  const path=mounted.svg.querySelector('path')!;const selector=`#${path.id || ''}`;
  // Export isolates pre-existing IDs; the body path in this fixture has none.
  const candidate=path.id ? model.forSelector(selector,0) : model.candidates.find(entry=>entry.node===path&&entry.kind==='part'&&entry.indices?.[0]===0)!;
  expect(candidate).toBeTruthy();const extracted=extractSelection(model,[candidate.id]);
  expect(()=>parseSvg(extracted.svg)).not.toThrow();
  const bounds=extracted.bounds;
  const original=new DOMParser().parseFromString(exported,'image/svg+xml').documentElement;
  // Remove the other disconnected part and second instance in an independent reference.
  const referencePath=original.querySelector('path')!;
  // The original compound path has bbox (20,30,70,45). Keep its gradient's
  // original coordinates when manually removing the other subpath.
  const gradient=original.querySelector('linearGradient')!;
  for(const [key,value] of Object.entries({gradientUnits:'userSpaceOnUse',gradientTransform:'matrix(70 0 0 45 20 30)',x1:'0',y1:'0',x2:'1',y2:'0'})) gradient.setAttribute(key,value);
  referencePath.setAttribute('d','M20 30h30v20h-30z');original.lastElementChild!.remove();
  const reference=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" width="${bounds.width}" height="${bounds.height}">${new XMLSerializer().serializeToString(original)}</svg>`;
  const actual=await pixels(extracted.svg),expected=await pixels(reference);let changed=0,max=0,painted=0;
  for(let i=0;i<actual.length;i++){const delta=Math.abs(actual[i]-expected[i]);if(delta)changed++;max=Math.max(max,delta);if(i%4===3&&actual[i]>0)painted++;}
  expect(painted).toBeGreaterThan(5000);expect(max).toBeLessThanOrEqual(2);expect(changed).toBeLessThan(1000);
  const second=exportComposition([{...item,svgContent:extracted.svg,x:300,y:200}]);const again=mountSvg(second),next=new SelectionModel(again.svg);
  try {expect(extractSelection(next,[next.candidates.find(entry=>entry.kind==='shape')!.id]).svg).toContain('linearGradient');}
  finally {next.dispose();again.dispose();}
 } finally {model.dispose();mounted.dispose();}
});
it('reimport extracts a partly out-of-canvas instance with its original root clipping',async()=>{
 const red='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><path fill="red" d="M0 0h100v80h-100z"/></svg>';
 const exported=exportComposition([{...item,svgContent:red,x:1190,y:795,scaleX:1,scaleY:1,rotation:0}]);
 const mounted=mountSvg(exported),model=new SelectionModel(mounted.svg);
 try {
  const result=extractSelection(model,[model.candidates.find(entry=>entry.kind==='shape')!.id]);
  expect(result.bounds).toEqual({x:1190,y:795,width:10,height:5});expect(result.svg).toContain('clipPath');
  const data=await pixels(result.svg);expect(data[4*(100*200+100)]).toBe(255);expect(data[4*(100*200+100)+3]).toBe(255);
 }finally{model.dispose();mounted.dispose();}
});
it('relative or missing nested viewport dimensions remain an explicit refusal',()=>{
 for(const dimensions of ['width="100%" height="80"','width="100"','width="1em" height="80"']) expect(()=>parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><svg ${dimensions} viewBox="0 0 100 80"><path d="M0 0h30v20z"/></svg></svg>`)).toThrow('Вложенному SVG');
});
