import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const directory=await mkdtemp(join(tmpdir(),'peeps-preview-'));
const origin='http://127.0.0.1:5176';
let server,browser;
async function start() {
 server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5176','--strictPort'],{env:{...process.env,PEEPS_DATA_DIR:directory},stdio:'pipe'});
 let errors='';server.stderr.on('data',data=>errors+=data);
 for(let attempt=0;attempt<100;attempt++) {
  if(server.exitCode!==null) throw new Error(errors || 'Preview server stopped');
  try {if((await fetch(origin)).ok) return;} catch {}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw new Error('Preview did not start');
}
async function stop() {if(server && server.exitCode===null){const closed=new Promise(resolve=>server.once('exit',resolve));server.kill();await closed;}}
try {
 await start();browser=await chromium.launch({channel:'chrome'});
 let page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{const native=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=callback=>native(time=>{setTimeout(()=>callback(time),150);});});
 await page.goto(origin);await page.getByRole('button',{name:'Загрузить SVG',exact:true}).waitFor();
 await page.getByRole('button',{name:'Открыть peep-sitting-7.svg',exact:true}).dblclick();
 await page.getByRole('status').filter({hasText:'Подготовка SVG…'}).first().waitFor();
 await page.mouse.move(1000,150);await page.screenshot({path:'docs/local-files-artifacts/source-loader.png',fullPage:true});
 await page.getByTestId('source-canvas').locator('svg').first().waitFor();
 await page.getByRole('link',{name:'Peeps — главная'}).click();
 await page.getByRole('button',{name:'Загрузить SVG',exact:true}).click();
 const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><rect width="100" height="80" fill="#668343"/></svg>';
 await page.getByLabel('Выбрать SVG-файлы',{exact:true}).setInputFiles({name:'persistent.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
 await page.getByRole('dialog').getByRole('button',{name:'Продолжить',exact:true}).click();
 await page.getByRole('textbox',{name:'Имя файла'}).fill('Проверка сохранности');
 await page.getByRole('dialog').getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 const before=await readFile(join(directory,'library.json'),'utf8');
 const catalog=JSON.parse(before),entry=catalog.sources.find(item=>item.name==='Проверка сохранности.svg');
 assert.equal(await readFile(join(directory,entry.path),'utf8'),svg);assert.deepEqual(errors,[]);
 await browser.close();browser=null;await stop();await start();
 browser=await chromium.launch({channel:'chrome'});page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto(origin);await page.getByRole('button',{name:'Открыть Проверка сохранности.svg',exact:true}).waitFor();
 assert.equal(await readFile(join(directory,'library.json'),'utf8'),before);
 await page.getByRole('button',{name:'Открыть Три характера.json',exact:true}).dblclick();
 await page.getByRole('button',{name:/^Выделить экземпляр/}).first().press('Enter');
 await page.mouse.move(1000,150);await page.screenshot({path:'docs/local-files-artifacts/numeric-fields.png',fullPage:true});
 const data={productionPreview:true,serverRestart:true,freshBrowser:true,exactSvgBytes:true,unchangedCatalog:true,pageErrors:errors,node:process.version,browser:browser.version()};
 await writeFile('docs/local-files-artifacts/preview.json',JSON.stringify(data,null,2));console.log(data);
} finally {await browser?.close();await stop();await rm(directory,{recursive:true,force:true});}
