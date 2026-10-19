import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { normalizeName, nameKey } from '../src/services/names.ts';
import type { Libraries, LibraryKind, StoredComposition, SvgRecord } from '../src/types/project.ts';

type Entry = { id: string; name: string; path: string; createdAt?: string; updatedAt?: string };
type Catalog = { version: 1; migrations: string[]; sources: Entry[]; components: Entry[]; compositions: Entry[] };
const kinds: LibraryKind[] = ['sources', 'components', 'compositions'];
const empty = (): Catalog => ({ version: 1, migrations: [], sources: [], components: [], compositions: [] });
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const error = (name: string, message: string): never => { throw Object.assign(new Error(message), { name }); };

/** Immutable record files + atomic catalog switch: readers see the old or the new revision. */
export class ProjectStorage {
  readonly directory: string;
  constructor(directory: string) { this.directory=directory; }
  private async atomic(path: string, content: string) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, content, { flag: 'wx' }); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
  }
  private async catalog(): Promise<Catalog | null> {
    try {
      const value = JSON.parse(await readFile(join(this.directory, 'library.json'), 'utf8'));
      if (value.version !== 1 || !Array.isArray(value.migrations) || !kinds.every(kind => Array.isArray(value[kind]))) throw new Error('Повреждён каталог файлов проекта.');
      return value;
    } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null; throw reason; }
  }
  private file(entry: Entry) {
    if (!/^(sources|components|compositions)\/[0-9a-f-]+\.(svg|json)$/.test(entry.path)) throw new Error('Некорректный путь файла в каталоге.');
    return join(this.directory, entry.path);
  }
  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true });
    const lock = join(this.directory, '.write-lock'), started = Date.now();
    for (;;) {
      try { await mkdir(lock); break; }
      catch (reason) {
        if ((reason as NodeJS.ErrnoException).code !== 'EEXIST') throw reason;
        // Reclaim a lock after a crashed process, never while its owner is alive.
        try {
          const pid = Number(await readFile(join(lock, 'pid'), 'utf8'));
          if (Number.isInteger(pid) && pid > 0) {
            try { process.kill(pid, 0); } catch (failure) { if ((failure as NodeJS.ErrnoException).code === 'ESRCH') await rm(lock, { recursive: true, force: true }); }
          }
        } catch (failure) {
          if ((failure as NodeJS.ErrnoException).code === 'ENOENT') {
            const details = await stat(lock).catch(() => null);
            if (details && Date.now() - details.mtimeMs > 30_000) await rm(lock, { recursive: true, force: true });
          }
        }
        if (Date.now() - started > 10_000) throw new Error('Файлы проекта заняты другой операцией. Повторите сохранение.');
        await delay(20);
      }
    }
    try { await writeFile(join(lock, 'pid'), String(process.pid)); return await operation(); }
    finally { await rm(lock, { recursive: true, force: true }); }
  }
  private async commit(catalog: Catalog) { await this.atomic(join(this.directory, 'library.json'), JSON.stringify(catalog, null, 2)); }
  private unique(catalog: Catalog, kind: LibraryKind, name: string, excluding?: string) {
    if (catalog[kind].some(entry => entry.id !== excluding && nameKey(entry.name) === nameKey(name))) error('ConstraintError', 'Такое имя уже есть в библиотеке.');
  }
  private svg(content: unknown): asserts content is string {
    if (typeof content !== 'string' || !/<(?:[\w-]+:)?svg\b/.test(content) || /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|<(?:script|foreignObject|image|animate|set)\b/i.test(content)) throw new Error('Нужен автономный статический SVG.');
  }
  private composition(project: StoredComposition): StoredComposition {
    if (!project || project.schemaVersion !== 1 || project.width !== 1200 || project.height !== 800 || typeof project.id !== 'string' || !project.id || !Array.isArray(project.instances) || !project.instances.length) throw new Error('Некорректный формат композиции.');
    const ids = new Set<string>();
    const instances = project.instances.map(item => {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.componentId !== 'string' || !item.componentId || ![item.x,item.y,item.scaleX,item.scaleY,item.rotation,item.zIndex].every(Number.isFinite) || Math.abs(item.x)>1e6 || Math.abs(item.y)>1e6 || Math.abs(item.rotation)>1e9 || item.scaleX<=0 || item.scaleY<=0 || item.scaleX>1e9 || item.scaleY>1e9 || !Number.isFinite(100/item.scaleX) || !Number.isFinite(100/item.scaleY) || !Number.isInteger(item.zIndex) || item.zIndex<0) throw new Error('Некорректная геометрия экземпляра.');
      this.svg(item.svgContent); ids.add(item.id);
      const tag = item.svgContent.match(/<(?:[\w-]+:)?svg\b[^>]*>/)?.[0] ?? '';
      const attribute = (name:string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`))?.[1];
      const box = attribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
      const rawWidth = box?.[2] ?? Number(attribute('width')), rawHeight = box?.[3] ?? Number(attribute('height'));
      const valid = Number.isFinite(rawWidth) && Number.isFinite(rawHeight) && rawWidth>0 && rawHeight>0;
      const width = valid ? rawWidth : 250, height = valid ? rawHeight : 450;
      if (![width*item.scaleX,height*item.scaleY].every(value=>Number.isFinite(value)&&value>0&&value<=1e6)) throw new Error('Размер экземпляра слишком велик.');
      return {id:item.id,componentId:item.componentId,svgContent:item.svgContent,x:item.x,y:item.y,scaleX:item.scaleX,scaleY:item.scaleY,rotation:item.rotation,zIndex:item.zIndex};
    }).sort((a,b)=>a.zIndex-b.zIndex).map((item,index)=>({...item,zIndex:index}));
    return {schemaVersion:1,id:project.id,name:normalizeName(project.name,'compositions'),width:1200,height:800,instances,updatedAt:project.updatedAt};
  }
  private async put(catalog: Catalog, kind: LibraryKind, record: SvgRecord | StoredComposition) {
    await mkdir(join(this.directory, kind), { recursive: true });
    const path = `${kind}/${randomUUID()}.${kind === 'compositions' ? 'json' : 'svg'}`;
    const content = kind === 'compositions' ? JSON.stringify(record, null, 2) : (record as SvgRecord).svgContent;
    await this.atomic(join(this.directory, path), content);
    const entry: Entry = { id: record.id, name: record.name, path, ...('createdAt' in record ? { createdAt:record.createdAt } : { updatedAt:record.updatedAt }) };
    catalog[kind] = [...catalog[kind].filter(item=>item.id!==record.id),entry];
  }
  private async read(catalog: Catalog): Promise<Libraries> {
    const result: Libraries = {sources:[],components:[],compositions:[]};
    for (const kind of kinds) for (const entry of catalog[kind]) {
      const content = await readFile(this.file(entry), 'utf8');
      if (kind === 'compositions') result.compositions.push(JSON.parse(content));
      else result[kind].push({id:entry.id,name:entry.name,createdAt:entry.createdAt!,svgContent:content});
    }
    return result;
  }
  async list() { const catalog = await this.catalog(); return { initialized:!!catalog, libraries:catalog ? await this.read(catalog) : null }; }
  async initialize(seed: Libraries, legacy = false) {
    return this.locked(async()=>{
      const previous = await this.catalog(), catalog = previous ?? empty();
      if (previous && !legacy) return;
      if (!seed || !kinds.every(kind=>Array.isArray(seed[kind]))) throw new Error('Некорректные данные переноса.');
      const digest = createHash('sha256').update(JSON.stringify(seed)).digest('hex');
      if (catalog.migrations.includes(digest)) return;
      const current = previous ? await this.read(previous) : {sources:[],components:[],compositions:[]};
      const remapped = new Map<string,string>();
      for (const kind of kinds) for (const initial of seed[kind]) {
        const match = current[kind].find(item=>item.id===initial.id);
        if (match && isDeepStrictEqual(match,initial)) continue;
        const record = {...initial};
        if (match) record.id = randomUUID();
        if (kind==='components') remapped.set(initial.id,record.id);
        const original = normalizeName(record.name,kind); record.name=original;
        let suffix=2;
        while(catalog[kind].some(item=>nameKey(item.name)===nameKey(record.name))) record.name=normalizeName(`${original.replace(/\.(svg|json)$/i,'')} (импорт ${suffix++})`,kind);
        if (kind==='compositions') {
          const project=record as StoredComposition;
          project.instances=project.instances.map(item=>({...item,componentId:remapped.get(item.componentId)??item.componentId}));
          await this.put(catalog,kind,this.composition(project));
        } else { this.svg((record as SvgRecord).svgContent); await this.put(catalog,kind,record); }
      }
      catalog.migrations.push(digest); await this.commit(catalog);
    });
  }
  async add(kind: 'sources'|'components', name: string, content: string) {
    this.svg(content);
    return this.locked(async()=>{
      const catalog=await this.catalog(); if(!catalog) throw new Error('Хранилище ещё не инициализировано.');
      const record: SvgRecord={id:randomUUID(),name:normalizeName(name,kind),svgContent:content,createdAt:new Date().toISOString()};
      this.unique(catalog,kind,record.name);await this.put(catalog,kind,record);await this.commit(catalog);return record;
    });
  }
  async save(project: StoredComposition, expectedRevision: string|null) {
    const record=this.composition(project);
    return this.locked(async()=>{
      const catalog=await this.catalog(); if(!catalog) throw new Error('Хранилище ещё не инициализировано.');
      const previous=catalog.compositions.find(item=>item.id===record.id);
      if(expectedRevision===null ? !!previous : !previous || previous.updatedAt!==expectedRevision) error('CompositionConflictError','Композиция изменена или удалена в другой вкладке. Сохраните черновик как копию.');
      this.unique(catalog,'compositions',record.name,record.id);
      record.updatedAt=new Date(Math.max(Date.now(),previous ? Date.parse(previous.updatedAt!)+1 : 0)).toISOString();
      await this.put(catalog,'compositions',record);await this.commit(catalog);return record;
    });
  }
  async remove(kind: LibraryKind, id: string) {
    await this.locked(async()=>{const catalog=await this.catalog();if(!catalog) throw new Error('Хранилище ещё не инициализировано.');catalog[kind]=catalog[kind].filter(entry=>entry.id!==id);await this.commit(catalog);});
  }
}

export function projectStoragePlugin(): Plugin {
  const store = new ProjectStorage(resolve(process.env.PEEPS_DATA_DIR ?? 'project-files'));
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/project-library')) return next();
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');
    try {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) throw new Error('Запрос должен приходить из этого редактора.');
      let result: unknown;
      if (req.method==='GET' && req.url==='/api/project-library') result=await store.list();
      else if(req.method==='POST' && req.url==='/api/project-library') {
        if(!req.headers['content-type']?.startsWith('application/json')) throw new Error('Ожидается JSON.');
        const chunks:Buffer[]=[];let size=0;
        for await (const chunk of req) {size+=chunk.length;if(size>64*1024*1024) throw new Error('Операция превышает лимит 64 МБ.');chunks.push(chunk);}
        const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        switch(body.action) {
          case 'initialize': await store.initialize(body.seed,body.legacy===true);result={ok:true};break;
          case 'add': if(!['sources','components'].includes(body.kind)) throw new Error('Неизвестная библиотека.');result=await store.add(body.kind,body.name,body.content);break;
          case 'save': result=await store.save(body.project,body.expectedRevision??null);break;
          case 'remove': if(!kinds.includes(body.kind)) throw new Error('Неизвестная библиотека.');await store.remove(body.kind,body.id);result={ok:true};break;
          default: throw new Error('Неизвестное действие.');
        }
      } else {res.statusCode=404;result={name:'Error',message:'Неизвестный адрес API.'};}
      res.end(JSON.stringify(result));
    } catch(reason) {const failure=reason as Error;res.statusCode=failure.name==='CompositionConflictError'?409:400;res.end(JSON.stringify({name:failure.name,message:failure.message}));}
  };
  return {name:'peeps-project-files',configureServer(server){server.middlewares.use(middleware);},configurePreviewServer(server){server.middlewares.use(middleware);}};
}
