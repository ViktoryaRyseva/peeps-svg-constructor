import { afterEach, expect, it } from 'vitest';
import { assertInstanceGeometry, geometry, isOutsideCanvas, resizeInstance, returnToCanvas } from '../services/transforms';
import { matchesSnapshot, snapshot, makeInstances, svgImage } from '../services/views';
import { validateSvgUpload, readSvgFiles } from '../services/svgUpload';
import { inspectSvg } from '../services/svgCompatibility';
import { mountSvg, parseSvg } from '../svg/base';
import { SelectionModel } from '../svg/model';
import { extractSelection } from '../svg/extract';
import { exportComposition } from '../services/compositionExport';
import { StorageService } from '../services/storage';
import type { InstanceView } from '../types/editor';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><rect width="100" height="80"/></svg>';
const item: InstanceView = { id:'asset',instanceId:'one',name:'A.svg',svgContent:svg,image:'display-only',x:160,y:150,scaleX:1,scaleY:1,rotation:0 };
const services: StorageService[] = [];
afterEach(async () => { for (const storage of services.splice(0)) await storage.db.delete(); });

it('rejects dangerous scalar values and finite products that overflow', () => {
  for (const value of [{x:1e308},{rotation:1e308},{scaleX:1e308},{scaleY:0},{x:NaN},{scaleX:1e-308}]) expect(() => assertInstanceGeometry({...item,...value})).toThrow();
  expect(() => resizeInstance(item,'se',{x:1e308,y:1e308})).toThrow();
  expect(item.x).toBe(160); expect(item.scaleX).toBe(1);
});
it('preserves valid precision and rejects overflowing geometry before database writes', async () => {
  const storage = new StorageService(`stabilization-${crypto.randomUUID()}`); services.push(storage); await storage.open();
  const entry = {id:'i',componentId:'c',svgContent:svg,x:12.123456789,y:-9.987654321,scaleX:1.25,scaleY:.8,rotation:450,zIndex:0};
  const project = {schemaVersion:1 as const,id:'p',name:'Scene',width:1200,height:800,instances:[entry]};
  const saved = await storage.saveComposition(project);
  await expect(storage.saveComposition({...project,instances:[{...entry,scaleX:1e308}]},saved.updatedAt)).rejects.toThrow();
  expect((await storage.list()).compositions[0]).toEqual(saved);
  expect(saved.instances[0].x).toBe(entry.x); expect(saved.instances[0].rotation).toBe(450);
});

for (const css of [
  '@keyframes pulse {to {opacity:0}} rect {animation:pulse 1s infinite}',
  '@-webkit-keyframes pulse {to {opacity:0}}',
  '@media all {rect {animation-name:pulse}}',
  'rect {transition:fill 1s}',
]) it(`rejects dynamic stylesheet before storage: ${css.slice(0,30)}`, () => {
  expect(() => validateSvgUpload(svg.replace('<rect',`<style>${css}</style><rect`))).toThrow(/анимации|переходы/);
});
it('rejects inline animation, preserves valid files in a mixed batch and never previews legacy animation', async () => {
  const dynamic = svg.replace('<rect','<rect style="animation: pulse 1s infinite"');
  expect(() => validateSvgUpload(dynamic)).toThrow('статический');
  const files = await readSvgFiles([new File([dynamic],'animated.svg'),new File([svg],'good.svg')]);
  expect(files.valid.map(value=>value.filename)).toEqual(['good.svg']); expect(files.errors[0]).toContain('animated.svg');
  expect(inspectSvg(dynamic).safePreview).toBe(false);
  expect(decodeURIComponent(svgImage(dynamic))).not.toContain('animation:');
});

it('explicitly refuses viewport-dependent transform origins instead of returning a blank component', () => {
  const text = svg.replace('<rect','<g transform="rotate(30)" transform-origin="50% 50%"><rect').replace('/></svg>','/></g></svg>');
  expect(() => parseSvg(text)).toThrow('transform-origin');
  expect(inspectSvg(text)).toMatchObject({canExtract:false,safePreview:true});
});
it('repeated malformed path preparation leaves no hidden hosts and has a readable error', () => {
  const before = document.body.children.length;
  for (let i=0;i<10;i++) {
    const mounted = mountSvg(svg.replace('<rect width="100" height="80"/>','<path d="M0 0 L"/>'));
    try { expect(()=>new SelectionModel(mounted.svg)).toThrow('Некорректный SVG-контур'); }
    finally { mounted.dispose(); }
  }
  expect(document.body.children.length).toBe(before);
});

for (const id of ['градиент', '🎨', 'literal%20']) it(`extracts and exports a local gradient ID: ${id}`, () => {
  const ref = encodeURIComponent(id);
  const text = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><defs><linearGradient id="${id}"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><path id="a" fill="url(#${ref})" d="M20 20h30v30h-30z M120 20h30v30h-30z"/></svg>`;
  const mounted=mountSvg(text),model=new SelectionModel(mounted.svg);
  try {
    const extracted=extractSelection(model,[model.forSelector('#a',0).id]);
    const result=exportComposition([{...item,svgContent:extracted.svg}]);
    const xml=new DOMParser().parseFromString(result,'image/svg+xml');
    expect(xml.querySelector('linearGradient')).not.toBeNull(); expect(xml.querySelectorAll('path')).toHaveLength(1);
    for (const node of xml.querySelectorAll('*')) for (const attr of node.attributes) for (const match of attr.value.matchAll(/url\(#([^)]+)\)/g)) expect(xml.getElementById(match[1])).not.toBeNull();
  } finally { model.dispose();mounted.dispose(); }
});

it('checks compatibility early without banning storage of static view-only SVGs', () => {
  for (const text of [svg.replace('viewBox="0 0 100 80"','width="100" height="80"'),svg.replace('<rect','<text>Hi</text><rect'),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">${svg}</svg>`]) {
    expect(()=>validateSvgUpload(text)).not.toThrow(); expect(inspectSvg(text)).toMatchObject({canExtract:false,safePreview:true});
  }
  expect(inspectSvg(svg)).toEqual({canExtract:true,safePreview:true});
});

it('places many additions inside the canvas and recovers rotated instances without altering other parameters', () => {
  const added=makeInstances(Array.from({length:100},()=>item));
  expect(added.every(value=>!isOutsideCanvas(value))).toBe(true);
  const outside={...item,x:2000,y:-1500,rotation:37,scaleX:1.2,scaleY:.8};
  expect(isOutsideCanvas(outside)).toBe(true);
  const restored=returnToCanvas(outside),box=geometry(restored);
  expect(isOutsideCanvas(restored)).toBe(false); expect(box.cx).toBe(600); expect(box.cy).toBe(400);
  expect({...restored,x:outside.x,y:outside.y}).toEqual(outside);
});
it('detects changes, reorder and exact return to baseline without serializing SVG or keeping image URLs', () => {
  const other={...item,instanceId:'two'},items=[item,other],base=snapshot(items);
  expect('image' in base[0]).toBe(false); expect(base[0].svgContent).toBe(svg);
  expect(matchesSnapshot([{...item},other],base)).toBe(true);
  expect(matchesSnapshot([{...item,x:161},other],base)).toBe(false);
  expect(matchesSnapshot([other,item],base)).toBe(false);
  expect(matchesSnapshot([{...item,svgContent:svg.replace('rect','circle')},other],base)).toBe(false);
  expect(matchesSnapshot([{...item,image:'a-different-preview'},other],base)).toBe(true);
  items[0]={...item,x:180}; expect(base[0].x).toBe(160); expect(matchesSnapshot([item,other],base)).toBe(true);
});
