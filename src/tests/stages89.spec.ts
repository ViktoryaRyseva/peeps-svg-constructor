import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { InstanceView } from '../types/editor';
import { clickSource } from './sourceHelpers';

const folder='docs/stages-8-9-artifacts';
const panel=(page:Page)=>page.getByRole('complementary',{name:'Правая панель инструментов'});
const dialog=(page:Page)=>page.getByRole('dialog');
const instances=(page:Page)=>page.getByRole('button',{name:/^Выделить экземпляр/});
const items=(page:Page):Promise<InstanceView[]>=>page.evaluate(async()=>{const path='/src/store/editor.ts';return (await import(path)).useEditorStore.getState().doc.items;});
const data=(page:Page)=>page.evaluate(async()=>{const path='/src/services/storage.ts';return (await import(path)).storage.list();});
async function field(page:Page,label:string,value:number) {const input=panel(page).getByRole('spinbutton',{name:label,exact:true});await input.fill(String(value));await input.press('Enter');}
async function zoom(page:Page,value:number) {
  let current=Number((await page.getByRole('group',{name:'Масштаб холста'}).innerText()).match(/\d+/)![0]);
  while(current!==value){await page.getByRole('button',{name:current<value?'Увеличить масштаб':'Уменьшить масштаб',exact:true}).click();current+=current<value?25:-25;}
  await page.getByTestId('artboard-scroll').evaluate(node=>{node.scrollTop=0;node.scrollLeft=0;});
}
async function fixtures(page:Page) {
  await page.goto('/');await expect(page.getByRole('complementary',{name:'Библиотеки'})).toBeVisible();
  await page.evaluate(async()=>{
    const path='/src/services/storage.ts';const {storage}=await import(path);
    for(const [name,color,vb] of [['A','#be4f42','0 0 100 80'],['B','#527da7','0 0 100 80'],['Tiny','#364b34','0 0 3 8']])
      await storage.addAsset('components',name,`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><rect width="100%" height="100%" fill="${color}"/></svg>`);
  });await page.reload();
  await page.getByRole('button',{name:'Создать композицию',exact:true}).click();
  for(const name of ['A.svg','B.svg']) await dialog(page).getByRole('checkbox',{name:`Выбрать ${name}`,exact:true}).check();
  await dialog(page).getByRole('button',{name:'Создать композицию',exact:true}).click();
}
async function drag(page:Page,start:{x:number;y:number},delta:{x:number;y:number}) {
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+delta.x,start.y+delta.y,{steps:8});await page.mouse.up();
}
test.beforeAll(async()=>{await mkdir(folder,{recursive:true});});

test('three actual extracted sources, chosen addition order, duplicate/delete and layers',async({page})=> {
  await page.goto('/');
  for(const [source,eye,name] of [['sitting-7',2,'Глаз 7'],['sitting-10',11,'Глаз 10'],['standing-24',5,'Глаз 24']] as const) {
    await page.getByRole('button',{name:`Открыть peep-${source}.svg`,exact:true}).dblclick();
    await clickSource(page,{indices:[eye],double:true});
    await panel(page).getByRole('button',{name:'Сохранить',exact:true}).click();
    await page.getByRole('textbox',{name:'Имя файла'}).fill(name);await dialog(page).getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog(page)).toHaveCount(0);
  }
  const before=await data(page);
  await page.getByRole('button',{name:'Создать композицию',exact:true}).click();
  for(const name of ['Глаз 24.svg','Глаз 7.svg','Глаз 10.svg']) await dialog(page).getByRole('checkbox',{name:`Выбрать ${name}`,exact:true}).check();
  await dialog(page).getByRole('button',{name:'Создать композицию',exact:true}).click();
  expect((await items(page)).map(item=>item.name)).toEqual(['Глаз 24.svg','Глаз 7.svg','Глаз 10.svg']);
  await instances(page).nth(0).press('Enter');await panel(page).getByRole('button',{name:'Вперёд',exact:true}).click();
  expect((await items(page)).map(item=>item.name)).toEqual(['Глаз 7.svg','Глаз 24.svg','Глаз 10.svg']);
  await panel(page).getByRole('button',{name:'Назад',exact:true}).click();
  const first=(await items(page))[0];await panel(page).getByRole('button',{name:'Дублировать',exact:true}).click();
  const copy=(await items(page))[3];expect(copy.instanceId).not.toBe(first.instanceId);expect(copy.svgContent).toBe(first.svgContent);expect(copy.x-first.x).toBe(20);
  await panel(page).getByRole('button',{name:'Удалить',exact:true}).click();await expect(instances(page)).toHaveCount(3);
  expect((await data(page)).components).toEqual(before.components);expect((await data(page)).sources).toEqual(before.sources);
});

for(const scale of [50,100,200]) test(`drag and group drag use canvas units at ${scale}%`,async({page})=> {
  await fixtures(page);await zoom(page,scale);
  const initial=await items(page),box=(await instances(page).nth(0).boundingBox())!,canvas=(await page.getByTestId('composition-canvas').boundingBox())!;
  const factor=canvas.width/1200;
  await drag(page,{x:box.x+box.width/2,y:box.y+box.height/2},{x:40*factor,y:30*factor});
  let result=await items(page);expect(result[0].x-initial[0].x).toBeCloseTo(40,5);expect(result[0].y-initial[0].y).toBeCloseTo(30,5);expect(result[1]).toEqual(initial[1]);
  await instances(page).nth(1).click({modifiers:['Shift']});await expect(panel(page).getByText('Выбрано: 2',{exact:true})).toBeVisible();
  const start=(await instances(page).nth(0).boundingBox())!;const before=result;
  await drag(page,{x:start.x+start.width/2,y:start.y+start.height/2},{x:20*factor,y:10*factor});result=await items(page);
  result.forEach((item,index)=>{expect(item.x-before[index].x).toBeCloseTo(20,5);expect(item.y-before[index].y).toBeCloseTo(10,5);});
  await expect(panel(page).getByText('Выбрано: 2',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Повернуть экземпляр'})).toHaveCount(0);
});

const directions={nw:[-1,-1],n:[0,-1],ne:[1,-1],e:[1,0],se:[1,1],s:[0,1],sw:[-1,1],w:[-1,0]};
for(const scale of [50,200]) for(const [handle,[sx,sy]] of Object.entries(directions)) test(`resize rotated ${handle} at ${scale}%`,async({page})=> {
  await fixtures(page);await instances(page).nth(0).click();await field(page,'Поворот',37);await zoom(page,scale);
  const before=(await items(page))[0],marker=(await page.getByRole('button',{name:`Масштабировать: ${handle}`,exact:true}).boundingBox())!;
  const canvas=(await page.getByTestId('composition-canvas').boundingBox())!, factor=canvas.width/1200;
  const local=sx&&sy?{x:sx*50,y:sy*40}:{x:sx*40,y:sy*20};
  const c=Math.cos(37*Math.PI/180),s=Math.sin(37*Math.PI/180);
  await drag(page,{x:marker.x+marker.width/2,y:marker.y+marker.height/2},{x:(local.x*c-local.y*s)*factor,y:(local.x*s+local.y*c)*factor});
  const result=(await items(page))[0];
  expect(result.scaleX).toBeCloseTo(sx?(sy?1.5:1.4):1,5);expect(result.scaleY).toBeCloseTo(sy?(sx?1.5:1.25):1,5);
  const anchor=(item:InstanceView)=>({x:item.x+100*item.scaleX/2-sx*100*item.scaleX/2*c+sy*80*item.scaleY/2*s,y:item.y+80*item.scaleY/2-sx*100*item.scaleX/2*s-sy*80*item.scaleY/2*c});
  expect(anchor(result).x).toBeCloseTo(anchor(before).x,5);expect(anchor(result).y).toBeCloseTo(anchor(before).y,5);
  expect((await items(page))[1].scaleX).toBe(1);expect(result.svgContent).toBe(before.svgContent);
});

for(const scale of [50,100,200]) test(`rotate around fixed center and persist at ${scale}%`,async({page})=> {
  await fixtures(page);await instances(page).nth(0).click();await zoom(page,scale);
  const before=(await items(page))[0],marker=(await page.getByRole('button',{name:'Повернуть экземпляр',exact:true}).boundingBox())!,canvas=(await page.getByTestId('composition-canvas').boundingBox())!,factor=canvas.width/1200;
  const center={x:canvas.x+(before.x+50)*factor,y:canvas.y+(before.y+40)*factor};
  const start={x:marker.x+marker.width/2,y:marker.y+marker.height/2};const vector={x:start.x-center.x,y:start.y-center.y};
  await page.mouse.move(start.x,start.y);await page.mouse.down();
  for(let i=1;i<=30;i++){const angle=i*450/30*Math.PI/180;await page.mouse.move(center.x+vector.x*Math.cos(angle)-vector.y*Math.sin(angle),center.y+vector.x*Math.sin(angle)+vector.y*Math.cos(angle));}
  await page.mouse.up();const result=(await items(page))[0];expect(result.rotation).toBeCloseTo(450,5);expect(result.x).toBe(before.x);expect(result.y).toBe(before.y);
  await panel(page).getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('textbox',{name:'Имя файла'}).fill(`Поворот ${scale}`);await dialog(page).getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog(page)).toHaveCount(0);
  await page.reload();await page.getByRole('button',{name:`Открыть Поворот ${scale}.json`,exact:true}).dblclick();expect((await items(page))[0].rotation).toBe(result.rotation);
});

test('cancel gesture, numeric transform, exact reopen and correctly sized tiny component',async({page})=> {
  await fixtures(page);await instances(page).nth(0).click();const before=await items(page),box=(await instances(page).nth(0).boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+50,box.y+box.height/2+30,{steps:5});
  expect((await items(page))[0].x).not.toBe(before[0].x);await page.keyboard.press('Escape');await page.mouse.up();expect(await items(page)).toEqual(before);
  for(const [label,value] of [['Ширина',150],['Высота',40],['Поворот',33.25],['X',280.123456],['Y',220.987654]] as const)await field(page,label,value);
  await page.screenshot({path:`${folder}/transformed.png`,fullPage:true});
  const changed=await items(page);expect(changed[0].scaleX).toBe(1.5);expect(changed[0].scaleY).toBe(.5);expect(changed[1]).toEqual(before[1]);
  await panel(page).getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('textbox',{name:'Имя файла'}).fill('Точные параметры');await dialog(page).getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog(page)).toHaveCount(0);
  await page.reload();await page.getByRole('button',{name:'Открыть Точные параметры.json',exact:true}).dblclick();
  const reopened=await items(page);for(let i=0;i<2;i++)for(const key of ['x','y','scaleX','scaleY','rotation','svgContent'] as const)expect(reopened[i][key]).toBe(changed[i][key]);
  await panel(page).getByRole('button',{name:'Добавить элемент',exact:true}).click();await dialog(page).getByRole('checkbox',{name:'Выбрать Tiny.svg',exact:true}).check();await dialog(page).getByRole('button',{name:'Добавить на холст',exact:true}).click();
  const tiny=(await instances(page).nth(2).boundingBox())!;expect(tiny.width).toBeCloseTo(1.8,1);expect(tiny.height).toBeCloseTo(4.8,1);
  await writeFile(`${folder}/reopened.json`,JSON.stringify({instances:reopened.map(({image:_image,...item})=>item),tiny:{width:tiny.width,height:tiny.height}},null,2)+'\n');
});

test('layer order changes painted overlap while selected handles remain accessible',async({page})=> {
  await fixtures(page);await instances(page).nth(1).click();await field(page,'X',160);await field(page,'Y',150);
  const top=(await instances(page).nth(1).boundingBox())!,center={x:top.x+top.width/2,y:top.y+top.height/2};
  const hit=()=>page.evaluate(point=>document.elementFromPoint(point.x,point.y)?.closest('[data-instance-id]')?.getAttribute('data-instance-id'),center);
  const before=await items(page);expect(await hit()).toBe(before[1].instanceId);
  // Keyboard can select the covered object without altering scene order.
  await instances(page).nth(0).press('Enter');
  const handle=page.getByRole('button',{name:'Масштабировать: se',exact:true});
  expect(await handle.evaluate(node=>{const b=node.getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===node;})).toBe(true);
  await panel(page).getByRole('button',{name:'Вперёд',exact:true}).click();expect(await hit()).toBe(before[0].instanceId);
  await panel(page).getByRole('button',{name:'Назад',exact:true}).click();expect(await hit()).toBe(before[1].instanceId);
});

test('nonuniform resize stretches actual SVG paint in the canvas and saved preview',async({page})=> {
  await fixtures(page);await instances(page).nth(0).click();await field(page,'Ширина',200);await field(page,'Высота',40);
  await page.getByTestId('composition-canvas').click({position:{x:20,y:20}});
  async function colors(png:Buffer) {
    return page.evaluate(async base64=>{
      const image=new Image();image.src=`data:image/png;base64,${base64}`;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const context=canvas.getContext('2d')!;context.drawImage(image,0,0);
      return [[180,160],[340,180],[480,190]].map(([x,y])=>[...context.getImageData(Math.floor(x/1200*canvas.width),Math.floor(y/800*canvas.height),1,1).data]);
    },png.toString('base64'));
  }
  const actual=await page.getByTestId('composition-canvas').screenshot();
  const expected=[[190,79,66,255],[190,79,66,255],[82,125,167,255]];
  expect(await colors(actual)).toEqual(expected);
  await panel(page).getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('textbox',{name:'Имя файла'}).fill('Растяжение');await dialog(page).getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog(page)).toHaveCount(0);
  await page.getByRole('button',{name:'Открыть Растяжение.json',exact:true}).hover();
  const preview=page.getByRole('img',{name:'Превью Растяжение.json',exact:true});await expect(preview).toBeVisible();
  const thumb=await preview.screenshot();expect(await colors(thumb)).toEqual(expected);
  await writeFile(`${folder}/nonuniform-canvas.png`,actual);await writeFile(`${folder}/nonuniform-preview.png`,thumb);
});

test('transforming a duplicate never changes another instance of the same library component',async({page})=> {
  await fixtures(page);await instances(page).nth(0).click();const before=await items(page),library=(await data(page)).components;
  await panel(page).getByRole('button',{name:'Дублировать',exact:true}).click();
  await field(page,'Ширина',200);await field(page,'Высота',40);await field(page,'Поворот',60);
  const after=await items(page);expect(after.slice(0,2)).toEqual(before);expect(after[2].id).toBe(before[0].id);expect(after[2].instanceId).not.toBe(before[0].instanceId);
  expect(after[2].scaleX).toBe(2);expect(after[2].scaleY).toBe(.5);expect(after[2].rotation).toBe(60);
  await panel(page).getByRole('button',{name:'Удалить',exact:true}).click();expect(await items(page)).toEqual(before);expect((await data(page)).components).toEqual(library);
});

test('a pending numeric edit is committed before starting a pointer gesture',async({page})=> {
  await fixtures(page);await instances(page).nth(0).click();const box=(await instances(page).nth(0).boundingBox())!;
  await panel(page).getByRole('spinbutton',{name:'Ширина',exact:true}).fill('200');
  await drag(page,{x:box.x+box.width/2,y:box.y+box.height/2},{x:30,y:12});
  const item=(await items(page))[0];expect(item.scaleX).toBe(2);expect(item.x).toBeCloseTo(210,5);expect(item.y).toBeCloseTo(170,5);
});
