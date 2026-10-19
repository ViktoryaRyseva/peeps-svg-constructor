import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStorage } from './projectStorage.ts';
import type { Libraries, StoredComposition } from '../src/types/project.ts';
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><rect width="100" height="80"/></svg>';
const seed=(): Libraries=>({sources:[{id:'source',name:'Исходник.svg',createdAt:'2026-01-01',svgContent:svg}],components:[{id:'component',name:'Деталь.svg',createdAt:'2026-01-01',svgContent:svg}],compositions:[]});
const project=(): StoredComposition=>({schemaVersion:1,id:'scene',name:'Сцена.json',width:1200,height:800,updatedAt:'',instances:[{id:'i',componentId:'component',svgContent:svg,x:20,y:30,scaleX:1,scaleY:1,rotation:37,zIndex:0}]});
async function fixture(run:(store:ProjectStorage,directory:string)=>Promise<void>) {const directory=await mkdtemp(join(tmpdir(),'peeps-files-'));try{await run(new ProjectStorage(directory),directory);}finally{await rm(directory,{recursive:true,force:true});}}
test('files survive a new service, use actual SVG/JSON and keep independent project snapshots',()=>fixture(async(store,directory)=>{
 await store.initialize(seed());const saved=await store.save(project(),null);await store.remove('components','component');
 const reopened=await new ProjectStorage(directory).list();assert.equal(reopened.libraries!.components.length,0);assert.equal(reopened.libraries!.compositions[0].instances[0].svgContent,svg);
 const catalog=JSON.parse(await readFile(join(directory,'library.json'),'utf8'));
 assert.equal(await readFile(join(directory,catalog.sources[0].path),'utf8'),svg);assert.deepEqual(JSON.parse(await readFile(join(directory,catalog.compositions[0].path),'utf8')),saved);
 await store.initialize(seed());assert.equal((await store.list()).libraries!.components.length,0);
}));
test('concurrent processes serialize names and optimistic revisions',()=>fixture(async(store,directory)=>{
 await store.initialize(seed());const other=new ProjectStorage(directory);
 const results=await Promise.allSettled([store.add('sources','НОВЫЙ',svg),other.add('sources','новый',svg)]);assert.equal(results.filter(value=>value.status==='fulfilled').length,1);
 const saved=await store.save(project(),null);
 const edits=await Promise.allSettled([store.save({...saved,instances:[{...saved.instances[0],x:70}]},saved.updatedAt),other.save({...saved,instances:[{...saved.instances[0],x:80}]},saved.updatedAt)]);
 assert.equal(edits.filter(value=>value.status==='fulfilled').length,1);assert.equal(edits.find(value=>value.status==='rejected')!.reason.name,'CompositionConflictError');
 await store.remove('compositions',saved.id);await assert.rejects(store.save(saved,saved.updatedAt),{name:'CompositionConflictError'});
}));
test('failed catalog commit keeps old revision readable',()=>fixture(async(store,directory)=>{
 await store.initialize(seed());const saved=await store.save(project(),null);
 const failing=store as unknown as {commit:()=>Promise<void>};const original=failing.commit;
 failing.commit=async()=>{throw new Error('disk unavailable');};
 await assert.rejects(store.save({...saved,instances:[{...saved.instances[0],x:99}]},saved.updatedAt),/disk unavailable/);failing.commit=original;
 assert.deepEqual((await new ProjectStorage(directory).list()).libraries!.compositions[0],saved);
}));
test('legacy migration is idempotent, preserves conflicting data and remaps references',()=>fixture(async(store)=>{
 await store.initialize(seed());const changed=seed();changed.components[0].svgContent=svg.replace('<rect','<circle');changed.compositions=[project()];
 await store.initialize(changed,true);const first=(await store.list()).libraries!;assert.equal(first.components.length,2);assert.match(first.components[1].name,/импорт/);assert.equal(first.compositions[0].instances[0].componentId,first.components[1].id);
 await store.initialize(changed,true);assert.deepEqual((await store.list()).libraries,first);
}));
test('invalid payload and interrupted lock never replace valid data',()=>fixture(async(store,directory)=>{
 await store.initialize(seed());const before=await store.list();
 await assert.rejects(store.save({...project(),instances:[{...project().instances[0],scaleX:1e308}]},null));
 await assert.rejects(store.add('sources','../escape',svg));assert.deepEqual(await store.list(),before);
 await mkdir(join(directory,'.write-lock'));await writeFile(join(directory,'.write-lock','pid'),'2147483647');
 await store.add('sources','После сбоя',svg);assert.equal((await store.list()).libraries!.sources.length,2);
 assert.ok((await readdir(directory)).includes('sources'));
}));
