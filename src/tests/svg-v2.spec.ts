import { expect, test } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import type {} from './fixtures/currentDriver';
import { openSvgFixture } from './fixtures/openSvgFixture';

const artifactDir = 'docs/stage-3-v2-artifacts';
type Entry = { name: string; fixture: string; selections: {selector: string; part?: number; expected?: number[]; expectedD?: string}[] };
// Manually specified acceptance expectations. Runtime topology is not used to
// construct reference paths: these indices refer to original absolute M contours.
const face = '[id^="face/"] > path';
const cases: Entry[] = [];
for (const [peep, parts] of [
  ['sitting-7', [[0],[1],[2],[3],[4],[5]]],
  ['sitting-10', [[0],[1],[2,3,4,5,6,7,8,9,10],[11],[12],[13]]],
  ['standing-24', [[0,1,2],[3,4],[5],[6],[7],[8]]],
] as const) {
  for (const indices of parts) cases.push({name: `${peep}-face-${indices[0]}`, fixture: `peep-${peep}.svg`, selections: [{selector: face, part: indices[0], expected: [...indices]}]});
  for (const [label, selector] of [['head', '[id="Head"]'], ['pose', '[id^="pose/"]']]) cases.push({name: `${peep}-${label}`, fixture: `peep-${peep}.svg`, selections: [{selector}]});
  cases.push({name: `${peep}-face-complete`, fixture: `peep-${peep}.svg`, selections: parts.map(indices => ({selector: face, part: indices[0], expected: [...indices]}))});
}
for (const kind of ['linear', 'radial', 'clip', 'mask']) for (const part of [0,1]) cases.push({name: `${kind}-${part}`, fixture: 'resources.svg', selections: [{selector: `#${kind}-detail`, part}]});
for (const [kind, part] of [['donut',0], ['donut',2], ['arc',0], ['arc',1]] as const) cases.push({name: `${kind}-${part}`, fixture: 'topology.svg', selections: [{selector:`#${kind}`, part}]});

for (const [name,fixture,selectors] of [
  ['legacy-gradient-mask','dependencies.svg',['#gradient-object']],
  ['legacy-radial-css','dependencies.svg',['#radial-object']],
  ['legacy-multiple','dependencies.svg',['#gradient-object','#radial-object']],
  ['legacy-stroke-transform','stroke.svg',['#stroke-object']],
] as const) cases.push({name,fixture,selections:selectors.map(selector=>({selector}))});

for (const [name,part,expectedD] of [
  ['nonzero',0,'M20 20h60v60h-60z M35 35h30v30h-30z'],
  ['nonzero',2,'M140 20h40v40h-40z'],
  ['overlap',0,'M20 20h50v50h-50z M50 20h50v50h-50z'],
  ['overlap',2,'M140 20h40v40h-40z'],
  ['self',0,'M20 20L60 60L20 60L50 20Z'],
  ['self',1,'M140 20h40v40h-40z'],
  ['stroke',0,'M20 20L60 20L40 60Z'],
  ['curves',0,'M20 30c10-10 20-10 30 0s20 10 30 0v30h-60z'],
  ['curves',1,'M140 30q10-10 20 0t20 0v30h-40z'],
] as const) cases.push({name:`edge-${name}-${part}`,fixture:'edge-cases.svg',selections:[{selector:`#${name}`,part,expectedD}]});

for (const entry of cases) test(`v2 pixel acceptance: ${entry.name}`, async ({ page, browser }) => {
  await mkdir(artifactDir, { recursive: true });
  await openSvgFixture(page, 'current');
  await page.waitForFunction(() => window.svgExperimentV2?.root());
  const result = await page.evaluate(async entry => {
    const api = window.svgExperimentV2;
    await api.load(entry.fixture, entry.fixture === 'dependencies.svg' || entry.fixture === 'stroke.svg' ? await (await fetch('/experiments/'+entry.fixture)).text() : undefined); api.select(entry.selections);
    const original = api.sourceText(), sourceBefore = new XMLSerializer().serializeToString(api.root());
    const extracted = api.run();
    const sourceUnchanged = new XMLSerializer().serializeToString(api.root()) === sourceBefore;
    const reference = new DOMParser().parseFromString(original, 'image/svg+xml').documentElement;
    const selected = entry.selections.map(item => reference.querySelector(item.selector)!);
    for (const shape of reference.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon')) {
      if (!shape.closest('defs,clipPath,mask') && !selected.some(node => node === shape || node.contains(shape))) (shape as SVGElement).style.setProperty('display','none','important');
    }
    if (entry.fixture.startsWith('peep-')) {
      const byNode = new Map<Element, number[]>();
      for (const item of entry.selections) if (item.expected) {
        const node = reference.querySelector(item.selector)!;
        byNode.set(node, [...byNode.get(node) ?? [], ...item.expected]);
      }
      for (const [node, indices] of byNode) {
        const d = node.getAttribute('d')!;
        if (d.includes('m')) throw new Error('Reference requires original absolute M paths');
        const originalParts = d.match(/M[^M]+/g)!;
        node.setAttribute('d', [...new Set(indices)].sort((a,b)=>a-b).map(index => originalParts[index]).join(' '));
      }
    } else if (entry.fixture === 'resources.svg' || entry.fixture === 'topology.svg') {
      // Independently authored expected geometry, never analyzer output.
      const item = entry.selections[0], node = selected[0];
      if (entry.fixture === 'resources.svg') {
        node.setAttribute('d', item.part === 0 ? 'M20 20h40v40h-40z' : 'M140 20h40v40h-40z');
        const linear = reference.querySelector('#linear')!;
        linear.setAttribute('gradientUnits','userSpaceOnUse'); linear.setAttribute('gradientTransform','translate(20 20) scale(160 40) rotate(15 .5 .5)');
        linear.setAttribute('x1','0'); linear.setAttribute('y1','0'); linear.setAttribute('x2','1'); linear.setAttribute('y2','0');
        const radial = reference.querySelector('#radial')!;
        radial.setAttribute('gradientUnits','userSpaceOnUse'); radial.setAttribute('gradientTransform','translate(20 20) scale(160 40)');
        for (const [key,value] of Object.entries({cx:'.35',cy:'.4',r:'.7',fx:'.35',fy:'.4'})) radial.setAttribute(key,value);
        const clip = reference.querySelector('#clip')!; clip.setAttribute('clipPathUnits','userSpaceOnUse'); clip.setAttribute('transform','translate(20 20) scale(160 40)');
        const mask = reference.querySelector('#mask')!; mask.setAttribute('maskUnits','userSpaceOnUse'); mask.setAttribute('maskContentUnits','userSpaceOnUse');
        for (const [key,value] of Object.entries({x:'4',y:'16',width:'192',height:'48'})) mask.setAttribute(key,value);
        const group = document.createElementNS(reference.namespaceURI,'g'); group.setAttribute('transform','translate(20 20) scale(160 40)'); group.append(...mask.childNodes); mask.append(group);
      } else if (item.selector === '#donut') node.setAttribute('d', item.part === 0 ? 'M20 20h80v80h-80z M40 40h40v40h-40z' : 'M150 20h60v60h-60z');
      else node.setAttribute('d', item.part === 0 ? 'M20 0a20 20 0 1 0 40 0a20 20 0 1 0-40 0z' : 'M150 0h30v30h-30z');
    }
    for (const item of entry.selections) if (item.expectedD) reference.querySelector(item.selector)!.setAttribute('d',item.expectedD);
    const b = extracted.bounds;
    const scale = Math.min(2, 1800 / Math.max(b.width, b.height));
    const width = Math.ceil(b.width * scale), height = Math.ceil(b.height * scale);
    reference.setAttribute('viewBox', `${b.x} ${b.y} ${b.width} ${b.height}`);
    reference.setAttribute('width', String(b.width)); reference.setAttribute('height', String(b.height));
    const referenceSvg = new XMLSerializer().serializeToString(reference);
    async function render(svg: string) {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      try {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, width, height);
        return { data: context.getImageData(0, 0, width, height).data, png: canvas.toDataURL('image/png').split(',')[1] };
      } finally { URL.revokeObjectURL(url); }
    }
    const referencePixels = await render(referenceSvg), actual = await render(extracted.svg);
    let mismatched = 0, visible = 0, maxDelta = 0;
    for (let offset = 0; offset < actual.data.length; offset += 4) {
      if (actual.data[offset + 3] || referencePixels.data[offset + 3]) visible++;
      let delta = 0;
      // Compare premultiplied colors; RGB in transparent pixels is irrelevant.
      for (let channel = 0; channel < 3; channel++) delta = Math.max(delta, Math.abs(actual.data[offset + channel] * actual.data[offset + 3] / 255 - referencePixels.data[offset + channel] * referencePixels.data[offset + 3] / 255));
      delta = Math.max(delta, Math.abs(actual.data[offset + 3] - referencePixels.data[offset + 3]));
      maxDelta = Math.max(maxDelta, delta); if (delta > 10) mismatched++;
    }
    return { ...extracted, referenceSvg, sourceUnchanged, png: actual.png, referencePng: referencePixels.png,
      pixels: { width, height, mismatched, visible, mismatchRatio: visible ? mismatched / visible : 1, maxDelta } };
  }, entry);
  await writeFile(`${artifactDir}/${entry.name}.svg`, result.svg);
  await writeFile(`${artifactDir}/${entry.name}-reference.svg`, result.referenceSvg);
  await writeFile(`${artifactDir}/${entry.name}.png`, Buffer.from(result.png, 'base64'));
  await writeFile(`${artifactDir}/${entry.name}-reference.png`, Buffer.from(result.referencePng, 'base64'));
  const { svg: _svg, referenceSvg: _reference, png: _png, referencePng: _referencePng, ...metrics } = result;
  await writeFile(`${artifactDir}/${entry.name}.json`, JSON.stringify({ ...entry, browser: browser.version(), ...metrics }, null, 2) + '\n');
  expect(result.sourceUnchanged).toBe(true);
  expect(result.pixels.visible).toBeGreaterThan(30);
  expect(result.pixels.maxDelta).toBeLessThanOrEqual(1);
  // The same actual SVG is decoded in a fresh page after its source was destroyed.
  await page.goto('about:blank');
  await page.setContent('<!doctype html><html><body><img alt="Самостоятельный SVG"></body></html>');
  await page.getByRole('img').evaluate((img: HTMLImageElement, svg: string) => {
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); return img.decode();
  }, result.svg);
  expect(await page.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth > 0 && img.naturalHeight > 0)).toBe(true);
  const standaloneDelta = await page.getByRole('img').evaluate(async (img: HTMLImageElement, expected: {png: string; width: number; height: number}) => {
    const reference = new Image(); reference.src = `data:image/png;base64,${expected.png}`; await reference.decode();
    const pixels = (image: HTMLImageElement) => {
      const canvas = document.createElement('canvas'); canvas.width = expected.width; canvas.height = expected.height;
      const context = canvas.getContext('2d')!; context.drawImage(image,0,0,expected.width,expected.height);
      return context.getImageData(0,0,expected.width,expected.height).data;
    };
    const actual = pixels(img), target = pixels(reference); let delta = 0;
    for(let i=0;i<actual.length;i++) delta = Math.max(delta,Math.abs(actual[i]-target[i]));
    return delta;
  }, {png:result.png,width:result.pixels.width,height:result.pixels.height});
  expect(standaloneDelta).toBeLessThanOrEqual(1);
});

test('v2 real pointer selection, zoom, smallest details and download', async ({ page }) => {
  await openSvgFixture(page, 'current');
  await page.waitForFunction(() => window.svgExperimentV2?.root());
  await page.getByLabel('Исходник:').selectOption('topology.svg');
  await expect(page.getByRole('status')).toContainText('Самостоятельных деталей: 4');
  const before = await page.evaluate(() => new XMLSerializer().serializeToString(window.svgExperimentV2.root()));
  await page.locator('#donut').click({ position: { x: 10, y: 10 } });
  expect(await page.evaluate(() => window.svgExperimentV2.selection()[0].kind)).toBe('group');
  await page.locator('#donut').dblclick({ position: { x: 10, y: 10 } });
  expect(await page.evaluate(() => window.svgExperimentV2.selection()[0].kind)).toBe('part');
  await page.locator('#donut').click({ position: { x: 140, y: 10 }, modifiers: ['Shift'] });
  expect(await page.evaluate(() => window.svgExperimentV2.selection().length)).toBe(2);
  await page.locator('#donut').click({ position: { x: 140, y: 10 }, modifiers: ['Shift'] });
  expect(await page.evaluate(() => window.svgExperimentV2.selection().length)).toBe(1);
  await page.getByLabel('Масштаб:').selectOption('2');
  await page.locator('#donut').dblclick({ position: { x: 20, y: 20 } });
  expect(await page.evaluate(() => window.svgExperimentV2.selection()[0].kind)).toBe('part');
  await page.getByRole('button', {name:'Извлечь выделение',exact:true}).click();
  await expect(page.getByRole('img', {name:'Извлечённая SVG-деталь'})).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button',{name:'Скачать SVG',exact:true}).click();
  expect((await downloadPromise).suggestedFilename()).toBe('extracted-detail.svg');
  await page.getByLabel('Масштаб:').selectOption('1');
  await page.locator('#donut').dblclick({position:{x:10,y:10}});
  expect(await page.evaluate(() => window.svgExperimentV2.selection()[0].kind)).toBe('part');
  await page.locator('#donut').click({position:{x:10,y:10}});
  expect(await page.evaluate(() => window.svgExperimentV2.selection()[0].kind)).toBe('group');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.svgExperimentV2.selection())).toEqual([]);
  expect(await page.evaluate(() => new XMLSerializer().serializeToString(window.svgExperimentV2.root()))).toBe(before);
});

test('v2 ten independent copies have isolated references and IDs', async ({ page }) => {
  await openSvgFixture(page, 'current');
  await page.waitForFunction(() => window.svgExperimentV2?.root());
  const check = await page.evaluate(async () => {
    const api = window.svgExperimentV2; await api.load('resources.svg'); api.select([{selector:'#linear-detail', part:1}]);
    const holder = document.createElement('div'); document.body.append(holder);
    const copies = Array.from({length:10}, () => api.run().svg); holder.innerHTML = copies.join('');
    const ids = [...holder.querySelectorAll('[id]')].map(node => node.id);
    const local = [...holder.querySelectorAll('svg')].every(svg => {
      const own = new Set([...svg.querySelectorAll('[id]')].map(node => node.id));
      return [...svg.querySelectorAll('*')].every(node => [...node.attributes].every(attr =>
        (attr.localName !== 'href' || !attr.value.startsWith('#') || own.has(attr.value.slice(1))) &&
        [...attr.value.matchAll(/url\(#([^)\s]+)\)/g)].every(match => own.has(match[1]))));
    });
    return {unique:new Set(ids).size === ids.length, count:copies.length, local};
  });
  expect(check).toEqual({unique:true,count:10,local:true});
});

test('v2 measured preparation, hit testing and extraction', async ({ page, browser }) => {
  await openSvgFixture(page, 'current');
  await page.waitForFunction(() => window.svgExperimentV2?.root());
  const measurements = await page.evaluate(async () => {
    const api = window.svgExperimentV2, rows = [];
    for (const name of ['peep-sitting-7.svg','peep-sitting-10.svg','peep-standing-24.svg', 'synthetic-50', 'synthetic-200','synthetic-500']) {
      const count = Number(name.split('-')[1]);
      const text = name.startsWith('synthetic') ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">${Array.from({length:count},(_,i)=>`<path id="p${i}" transform="translate(${i%25*40} ${Math.floor(i/25)*30})" d="M2 2h10v10h-10z M20 2h10v10h-10z"/>`).join('')}</svg>` : undefined;
      const started = performance.now(); await api.load(name,text); const loadMs = performance.now()-started;
      const model = api.model(), candidate = model.candidates.filter(value=>value.kind==='part').at(-1)!;
      const b = candidate.probe!.getBBox(), matrix = candidate.node.getScreenCTM()!;
      const point = new DOMPoint(b.x+b.width*.1,b.y+b.height*.1).matrixTransform(matrix);
      const hits = [];
      for(let i=0;i<200;i++){ const start=performance.now(); model.choose(candidate.node,point.x,point.y,true); hits.push(performance.now()-start); }
      hits.sort((a,b)=>a-b);
      api.select([{selector: name.startsWith('synthetic')?`#p${count-1}`:'[id^="face/"] > path',part:0}]);
      const extracted = api.run();
      rows.push({name,loadMs,...model.stats, hitP50Ms:hits[100],hitP95Ms:hits[190],extractionMs:extracted.extractionMs});
    }
    return rows;
  });
  await writeFile(`${artifactDir}/performance.json`,JSON.stringify({browser:browser.version(),measurements},null,2)+'\n');
  for(const row of measurements){ expect(row.parts).toBeGreaterThan(1); expect(row.preparationMs).toBeLessThan(5000); expect(row.hitP95Ms).toBeLessThan(50); }
});

test('v2 visual contact sheet of all accepted face details', async ({page}) => {
  const rows = [];
  for (const peep of ['sitting-7','sitting-10','standing-24']) {
    const parts = cases.filter(entry=>entry.name.startsWith(peep+'-face-')&&!entry.name.endsWith('complete'));
    const cells = [];
    for(const entry of parts){const png=await readFile(`${artifactDir}/${entry.name}.png`);cells.push(`<figure><img src="data:image/png;base64,${png.toString('base64')}"><figcaption>${entry.name}</figcaption></figure>`);}
    rows.push(`<section><h2>${peep}</h2><div>${cells.join('')}</div></section>`);
  }
  await page.setContent(`<html><head><style>body{font:14px system-ui;background:#f5f5f0;padding:20px;color:#243b30}section>div{display:flex;gap:12px}figure{margin:0;padding:14px;background:white;border:1px solid #d4dacd;width:190px;min-height:140px;display:flex;flex-direction:column;justify-content:space-between;align-items:center}img{max-width:150px;max-height:85px;min-height:20px;object-fit:contain;image-rendering:auto}figcaption{font-size:11px;margin-top:16px}</style></head><body><h1>Peep · независимые детали лица</h1>${rows.join('')}</body></html>`);
  await page.screenshot({path:`${artifactDir}/face-details.png`,fullPage:true});
  await openSvgFixture(page, 'current'); await page.waitForFunction(()=>window.svgExperimentV2?.root());
  await page.evaluate(()=>window.svgExperimentV2.select([{selector:'[id^="face/"] > path',part:0}]));
  await page.getByRole('button',{name:'Извлечь выделение',exact:true}).click();
  await expect(page.getByRole('img',{name:'Извлечённая SVG-деталь'})).toBeVisible();
  await page.screenshot({path:`${artifactDir}/laboratory.png`,fullPage:true});
});
