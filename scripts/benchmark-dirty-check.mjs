import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage(); await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('complementary', { name: 'Библиотеки' }).waitFor();
  const values = await page.evaluate(async () => {
    const { makeInstances, snapshot, matchesSnapshot, assetView } = await import('/src/services/views.ts');
    const { storage } = await import('/src/services/storage.ts');
    const asset = assetView((await storage.list()).components[0]);
    const median = fn => { const samples = []; for (let i = 0; i < 15; i++) { const start = performance.now(); fn(); samples.push(performance.now() - start); } return samples.sort((a,b)=>a-b)[7]; };
    return [10,50,200].map(count => {
      const items = makeInstances(Array.from({length:count},()=>asset)), baseline = snapshot(items);
      const legacy = () => JSON.stringify(items.map(({image:_image,...item})=>item));
      return { count, legacyMedianMs: median(legacy), currentMedianMs: median(()=>matchesSnapshot(items,baseline)), matches: matchesSnapshot(items,baseline) };
    });
  });
  const folder = 'docs/stabilization-artifacts'; await mkdir(folder, {recursive:true});
  await writeFile(`${folder}/dirty-check.json`, JSON.stringify({browser:browser.version(), measurements:values},null,2)+'\n');
  console.log(JSON.stringify(values,null,2));
} finally { await browser.close(); }
