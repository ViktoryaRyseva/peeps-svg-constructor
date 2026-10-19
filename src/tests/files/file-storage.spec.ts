import { test, expect, type Page } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { clickSource } from '../sourceHelpers';
const directory=process.env.PEEPS_TEST_DATA!;
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><path id="detail" fill="red" d="M10 10h30v20h-30z M60 40h20v20h-20z"/></svg>';
const dialog=(page:Page)=>page.getByRole('dialog');
const panel=(page:Page)=>page.getByRole('complementary',{name:'Правая панель инструментов'});
async function ready(page:Page) {await page.goto('/');await expect(page.getByRole('button',{name:'Загрузить SVG',exact:true})).toBeVisible();}
async function upload(page:Page,text:string,name:string) {
 await page.getByRole('button',{name:'Загрузить SVG',exact:true}).click();
 await page.getByLabel('Выбрать SVG-файлы',{exact:true}).setInputFiles({name:`${name}.svg`,mimeType:'image/svg+xml',buffer:Buffer.from(text)});
 await dialog(page).getByRole('button',{name:'Продолжить',exact:true}).click();await page.getByRole('textbox',{name:'Имя файла'}).fill(name);
 await dialog(page).getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog(page)).toHaveCount(0);
}
test.beforeEach(async()=>{if(!directory || !directory.includes('peeps-file-ui-')) throw new Error('Expected isolated test folder');await rm(directory,{recursive:true,force:true});});
test.afterAll(async()=>{await rm(directory,{recursive:true,force:true});});

test('uploaded files survive a completely new browser context and have exact bytes on disk',async({page,browser})=>{
 await ready(page);await upload(page,svg,'На диске');
 const catalog=JSON.parse(await readFile(join(directory,'library.json'),'utf8'));const entry=catalog.sources.find((item:{name:string})=>item.name==='На диске.svg');
 expect(await readFile(join(directory,entry.path),'utf8')).toBe(svg);
 const context=await browser.newContext();const fresh=await context.newPage();await ready(fresh);
 await expect(fresh.getByRole('button',{name:'Открыть На диске.svg',exact:true})).toBeVisible();
 await fresh.getByRole('button',{name:'Открыть На диске.svg',exact:true}).dblclick();await clickSource(fresh,{selector:'#detail',indices:[0],double:true});
 await expect(panel(fresh).getByRole('button',{name:'Сохранить',exact:true})).toBeEnabled();await context.close();
});

test('real download can be uploaded, selected, saved as a component and exported again',async({page})=>{
 await ready(page);await page.evaluate(async(svg)=>{
  const modulePath='/src/services/storage.ts';const {storage}=await import(modulePath);const component=await storage.addAsset('components','Два контура',svg);
  await storage.saveComposition({schemaVersion:1,id:'round-trip',name:'Повтор',width:1200,height:800,instances:[{id:'a',componentId:component.id,svgContent:svg,x:220,y:160,scaleX:1.3,scaleY:.8,rotation:37,zIndex:0}]});
 },svg);await page.reload();await page.getByRole('button',{name:'Открыть Повтор.json',exact:true}).dblclick();
 await page.getByRole('button',{name:'Экспорт',exact:true}).click();const download=page.waitForEvent('download');
 await dialog(page).getByRole('button',{name:'Подтвердить экспорт',exact:true}).click();const file=await download;const text=await readFile((await file.path())!,'utf8');
 await page.getByRole('link',{name:'Peeps — главная'}).click();await upload(page,text,'Наш экспорт');
 await page.getByRole('button',{name:'Открыть Наш экспорт.svg',exact:true}).dblclick();
 await expect(page.getByText(/Только просмотр/)).toHaveCount(0);await clickSource(page,{selector:'path',indices:[0],double:true});
 await panel(page).getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('textbox',{name:'Имя файла'}).fill('После импорта');
 await dialog(page).getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog(page)).toHaveCount(0);
 await page.getByRole('link',{name:'Peeps — главная'}).click();await page.getByRole('button',{name:'Открыть После импорта.svg',exact:true}).dblclick();
 await dialog(page).getByRole('button',{name:'Да, создать',exact:true}).click();await page.getByRole('button',{name:'Экспорт',exact:true}).click();
 const second=page.waitForEvent('download');await dialog(page).getByRole('button',{name:'Подтвердить экспорт',exact:true}).click();
 expect(await readFile((await (await second).path())!,'utf8')).toContain('<path');
});

test('loader is visible before SVG preparation, cancellation leaves no late model',async({page})=>{
 await ready(page);await page.evaluate(()=>{
  const native=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=callback=>native(time=>{setTimeout(()=>callback(time),150);});
 });
 await page.getByRole('button',{name:'Открыть peep-sitting-7.svg',exact:true}).dblclick();
 await expect(page.getByRole('status').filter({hasText:'Подготовка SVG…'}).first()).toBeVisible();
 await page.getByRole('link',{name:'Peeps — главная'}).click();await expect(page.getByTestId('source-canvas')).toHaveCount(0);
 await page.waitForTimeout(400);expect(await page.locator('body > div').count()).toBe(1);
});

test('a file API error keeps the dialog and draft; retry writes the file',async({page})=>{
 await ready(page);await page.getByRole('button',{name:'Загрузить SVG',exact:true}).click();
 await page.getByLabel('Выбрать SVG-файлы',{exact:true}).setInputFiles({name:'retry.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
 await dialog(page).getByRole('button',{name:'Продолжить',exact:true}).click();await page.getByRole('textbox',{name:'Имя файла'}).fill('Повтор записи');
 await page.route('**/api/project-library',async route=>{
  if(route.request().postDataJSON()?.action==='add') {await new Promise(resolve=>setTimeout(resolve,300));await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({name:'Error',message:'Ошибка диска'})});}
  else await route.continue();
 });
 await dialog(page).getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog(page).getByRole('status')).toBeVisible();
 await expect(dialog(page).getByRole('alert')).toContainText('Ошибка диска');await expect(page.getByRole('textbox',{name:'Имя файла'})).toHaveValue('Повтор записи');
 await page.unroute('**/api/project-library');await dialog(page).getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog(page)).toHaveCount(0);
 expect(JSON.parse(await readFile(join(directory,'library.json'),'utf8')).sources.some((item:{name:string})=>item.name==='Повтор записи.svg')).toBe(true);
});

test('legacy browser data is migrated without deleting IndexedDB, then loads in another browser',async({page,browser})=>{
 // Create legacy data before application modules initialize.
 await page.goto('/index.html');await expect(page.getByRole('button',{name:'Загрузить SVG',exact:true})).toBeVisible();
 await page.evaluate(async svg=>{const modulePath='/src/services/storage.ts';const {StorageService}=await import(modulePath);const legacy=new StorageService();await legacy.open();await legacy.addAsset('sources','Старая библиотека',svg);legacy.db.close();},svg);
 await page.reload();await expect(page.getByRole('button',{name:'Открыть Старая библиотека.svg',exact:true})).toBeVisible();
 await page.reload();const catalog=JSON.parse(await readFile(join(directory,'library.json'),'utf8'));expect(catalog.sources.filter((item:{name:string})=>item.name==='Старая библиотека.svg')).toHaveLength(1);
 expect(await page.evaluate(async()=>{const modulePath='/src/services/storage.ts';const {StorageService}=await import(modulePath);const legacy=new StorageService();await legacy.open();try{return (await legacy.list()).sources.length;}finally{legacy.db.close();}})).toBe(1);
 const context=await browser.newContext();const fresh=await context.newPage();await ready(fresh);await expect(fresh.getByRole('button',{name:'Открыть Старая библиотека.svg',exact:true})).toBeVisible();await context.close();
});

test('file storage detects stale tabs and saves a copy without overwriting the newer scene',async({page,context})=>{
 await ready(page);const other=await context.newPage();await ready(other);
 for(const tab of [page,other]) {await tab.getByRole('button',{name:'Открыть Три характера.json',exact:true}).dblclick();await tab.getByRole('button',{name:/^Выделить экземпляр/}).first().press('Enter');}
 for(const [tab,x] of [[page,'100'],[other,'400']] as const) {const input=panel(tab).getByRole('spinbutton',{name:'X',exact:true});await input.fill(x);await input.press('Enter');}
 await panel(page).getByRole('button',{name:'Сохранить',exact:true}).click();await dialog(page).getByRole('button',{name:'Да, перезаписать',exact:true}).click();await expect(dialog(page)).toHaveCount(0);
 await panel(other).getByRole('button',{name:'Сохранить',exact:true}).click();await dialog(other).getByRole('button',{name:'Да, перезаписать',exact:true}).click();
 await expect(dialog(other).getByRole('alert')).toContainText('другой вкладке');await expect(panel(other).getByRole('spinbutton',{name:'X',exact:true})).toHaveValue('400');
 await dialog(other).getByRole('button',{name:'Сохранить копию',exact:true}).click();await other.getByRole('textbox',{name:'Имя файла'}).fill('Копия вкладки');
 await dialog(other).getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog(other)).toHaveCount(0);
 const catalog=JSON.parse(await readFile(join(directory,'library.json'),'utf8'));
 const original=catalog.compositions.find((item:{id:string})=>item.id==='composition-1');const copy=catalog.compositions.find((item:{name:string})=>item.name==='Копия вкладки.json');
 expect(JSON.parse(await readFile(join(directory,original.path),'utf8')).instances[0].x).toBe(100);expect(JSON.parse(await readFile(join(directory,copy.path),'utf8')).instances[0].x).toBe(400);
 await other.close();
});

test('file library works even when the browser blocks IndexedDB',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('Blocked','SecurityError');},configurable:true});});
 await ready(page);await expect(page.getByRole('status').filter({hasText:'Прежнее хранилище браузера недоступно'})).toBeVisible();
 await upload(page,svg,'Без IndexedDB');await page.reload();await expect(page.getByRole('button',{name:'Открыть Без IndexedDB.svg',exact:true})).toBeVisible();
});
