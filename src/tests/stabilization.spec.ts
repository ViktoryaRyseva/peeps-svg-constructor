import { expect, test, type Page } from '@playwright/test';
import { clickSource } from './sourceHelpers';

const panel=(page:Page)=>page.getByRole('complementary',{name:'Правая панель инструментов'});
const dialog=(page:Page)=>page.getByRole('dialog');
const records=(page:Page)=>page.evaluate(async()=>{const path='/src/services/storage.ts';return (await import(path)).storage.list();});
const items=(page:Page)=>page.evaluate(async()=>{const path='/src/store/editor.ts';return (await import(path)).useEditorStore.getState().doc.items;});
async function field(page:Page,name:string,value:number) {const input=panel(page).getByRole('spinbutton',{name,exact:true});await input.fill(String(value));await input.press('Enter');}
async function choose(page:Page,text:string,filename='test.svg') {
  await page.getByRole('button',{name:'Загрузить SVG',exact:true}).click();
  await page.getByLabel('Выбрать SVG-файлы',{exact:true}).setInputFiles({name:filename,mimeType:'image/svg+xml',buffer:Buffer.from(text)});
}
async function finishUpload(page:Page,name:string) {
  await dialog(page).getByRole('button',{name:'Продолжить',exact:true}).click();
  await page.getByRole('textbox',{name:'Имя файла'}).fill(name);
  await dialog(page).getByRole('button',{name:'Сохранить',exact:true}).click();
  await expect(dialog(page)).toHaveCount(0);
}
async function scene(page:Page) {
  await page.goto('/');await page.getByRole('button',{name:'Открыть Три характера.json',exact:true}).dblclick();
  await page.getByRole('button',{name:/^Выделить экземпляр/}).first().press('Enter');
}
async function overwrite(page:Page) {
  await panel(page).getByRole('button',{name:'Сохранить',exact:true}).click();
  await dialog(page).getByRole('button',{name:'Да, перезаписать',exact:true}).click();await expect(dialog(page)).toHaveCount(0);
}
const wrap=(body:string)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">${body}</svg>`;

test('huge numeric edits keep valid geometry, then ordinary edits still save and reopen',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await scene(page);const before=await items(page);
  for(const label of ['X','Y','Ширина','Высота','Поворот']) {
    await field(page,label,1e308);
    await expect(panel(page).getByRole('alert')).toContainText('Значение слишком велико');
    expect(await items(page)).toEqual(before);
  }
  await field(page,'Ширина',150);await field(page,'Поворот',37);await overwrite(page);
  const after=await items(page);await page.reload();await page.getByRole('button',{name:'Открыть Три характера.json',exact:true}).dblclick();
  expect(await items(page)).toEqual(after);expect(errors).toEqual([]);
});

test('Unicode gradient survives native detail selection, storage and independent image rendering',async({page})=>{
  await page.goto('/');
  await choose(page,wrap('<defs><linearGradient id="градиент" gradientUnits="userSpaceOnUse" x1="20" y1="0" x2="50" y2="0"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><path id="a" fill="url(#градиент)" d="M20 20h30v30h-30z M120 20h30v30h-30z"/>'));
  await finishUpload(page,'Русский градиент');await page.getByRole('button',{name:'Открыть Русский градиент.svg',exact:true}).dblclick();
  await clickSource(page,{selector:'#a',indices:[0],double:true});
  await panel(page).getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.getByRole('textbox',{name:'Имя файла'}).fill('Цветная деталь');await dialog(page).getByRole('button',{name:'Сохранить',exact:true}).click();
  await expect(dialog(page)).toHaveCount(0);await page.reload();
  const stored=(await records(page)).components.find((entry:{name:string})=>entry.name==='Цветная деталь.svg');expect(stored).toBeTruthy();
  const pixels=await page.evaluate(async(text:string)=>{
    const image=new Image();image.src=`data:image/svg+xml,${encodeURIComponent(text)}`;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=30;canvas.height=30;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0,30,30);
    return [Array.from(ctx.getImageData(4,15,1,1).data),Array.from(ctx.getImageData(25,15,1,1).data)];
  },stored.svgContent);
  expect(pixels[0][0]).toBeGreaterThan(pixels[0][2]);expect(pixels[1][2]).toBeGreaterThan(pixels[1][0]);expect(pixels[0][3]).toBe(255);
});

test('animated uploads are rejected per file before preview and never enter the library',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Загрузить SVG',exact:true}).click();
  await page.getByLabel('Выбрать SVG-файлы',{exact:true}).setInputFiles([
    {name:'animated.svg',mimeType:'image/svg+xml',buffer:Buffer.from(wrap('<style>@keyframes a {to {opacity:0}}rect{animation:a 1s infinite}</style><rect width="100" height="80"/>'))},
    {name:'good.svg',mimeType:'image/svg+xml',buffer:Buffer.from(wrap('<rect width="100" height="80"/>'))},
  ]);
  await expect(dialog(page).getByRole('alert')).toContainText('animated.svg');
  await finishUpload(page,'Статика');const saved=await records(page);expect(saved.sources).toHaveLength(4);
  expect(saved.sources.every((entry:{svgContent:string})=>!entry.svgContent.includes('@keyframes'))).toBe(true);
});

test('legacy animated records remain stored but their previews and source view do not execute animation',async({page})=>{
  await page.goto('/');await expect(page.getByRole('complementary',{name:'Библиотеки'})).toBeVisible();
  await page.evaluate(async()=>{
    const path='/src/services/storage.ts';const {storage}=await import(path);
    await storage.db.sources.add({id:'legacy',name:'Legacy.svg',nameKey:'legacy.svg',createdAt:new Date().toISOString(),svgContent:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>@keyframes pulse{to{fill:red}}rect{animation:pulse 1s infinite}</style><rect width="100" height="100"/></svg>'});
  });await page.reload();
  await page.getByRole('button',{name:'Открыть Legacy.svg',exact:true}).hover();
  const preview=page.getByRole('img',{name:'Превью Legacy.svg',exact:true});expect(decodeURIComponent(await preview.getAttribute('src')??'')).not.toContain('keyframes');
  await page.getByRole('button',{name:'Открыть Legacy.svg',exact:true}).dblclick();
  await expect(page.getByRole('status').filter({hasText:'Только просмотр'})).toContainText('CSS-анимации');
  await expect(page.getByRole('img',{name:'Просмотр исходника'})).toHaveCount(0);
  expect((await records(page)).sources).toHaveLength(4);
});

test('unsupported transform origin has an early warning, cancellable save and view-only source',async({page})=>{
  await page.goto('/');const text=wrap('<g transform="rotate(30)" transform-origin="50% 50%"><rect x="80" y="40" width="30" height="20"/></g>');
  await choose(page,text);await expect(dialog(page).getByText(/Только просмотр/)).toContainText('transform-origin');
  await dialog(page).getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect(dialog(page).getByText(/Только просмотр/)).toContainText('transform-origin');
  await dialog(page).getByRole('button',{name:'Отмена',exact:true}).click();expect((await records(page)).sources).toHaveLength(3);
  await choose(page,text);await finishUpload(page,'Особый поворот');await page.getByRole('button',{name:'Открыть Особый поворот.svg',exact:true}).dblclick();
  await expect(page.getByRole('img',{name:'Просмотр исходника'})).toBeVisible();
  await expect(page.getByRole('status').filter({hasText:'Только просмотр'})).toContainText('transform-origin');
  await expect(panel(page).getByRole('button',{name:'Сохранить',exact:true})).toBeDisabled();
  expect((await records(page)).components).toHaveLength(3);
});

test('reopening a malformed path repeatedly has no leaked body hosts or unhandled errors',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await choose(page,wrap('<path d="M0 0 L"/>'));await finishUpload(page,'Повреждённый контур');
  const before=await page.locator('body > div').count();
  for(let attempt=0;attempt<5;attempt++) {
    await page.getByRole('button',{name:'Открыть Повреждённый контур.svg',exact:true}).dblclick();
    await expect(page.getByRole('alert')).toContainText('Некорректный SVG-контур');
    expect(await page.locator('body > div').count()).toBe(before);
    await page.getByRole('link',{name:'Peeps — главная'}).click();
  }expect(errors).toEqual([]);
});

test('reopened off-canvas object can return without changing scale, angle, SVG or layers',async({page})=>{
  await scene(page);await field(page,'X',1800);await field(page,'Y',1700);await field(page,'Поворот',37);await overwrite(page);
  const before=await items(page);await page.reload();await page.getByRole('button',{name:'Открыть Три характера.json',exact:true}).dblclick();
  await expect(panel(page).getByText('Нет выделения',{exact:true})).toBeVisible();
  await panel(page).getByRole('button',{name:'Вернуть на холст',exact:true}).click();const after=await items(page);
  expect(after.slice(1)).toEqual(before.slice(1));expect({...after[0],x:before[0].x,y:before[0].y}).toEqual(before[0]);
  expect(after[0].x).toBeLessThan(1200);await overwrite(page);await page.reload();
  await page.getByRole('button',{name:'Открыть Три характера.json',exact:true}).dblclick();expect(await items(page)).toEqual(after);
});

test('returning exactly to baseline clears dirty; selection and zoom never dirty the scene',async({page})=>{
  await scene(page);const before=(await items(page))[0];
  await field(page,'X',before.x+40);await expect(page.getByText('Есть несохранённые изменения',{exact:true})).toBeVisible();
  await field(page,'X',before.x);await expect(page.getByText('Все изменения сохранены',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Увеличить масштаб',exact:true}).click();
  await expect(panel(page).getByRole('button',{name:'Сохранить',exact:true})).toBeDisabled();
  await page.getByRole('link',{name:'Peeps — главная'}).click();await expect(dialog(page)).toHaveCount(0);
});
