import { LibraryDatabase } from './database';
import { nameKey, normalizeName } from './names';
import { validateSvgUpload } from './svgUpload';
import { assertInstanceGeometry } from './transforms';
import type { CompositionProject, Libraries, LibraryKind, StoredComposition, SvgRecord } from '../types/project';

export class CompositionConflictError extends Error {
  constructor() {
    super('Композиция изменена или удалена в другой вкладке. Черновик остаётся на холсте. Сохраните его как копию или отмените действие.');
    this.name = 'CompositionConflictError';
  }
}

export class StorageService {
  readonly db: LibraryDatabase;
  private seed?: Libraries;
  constructor(name?: string) {
    this.db = new LibraryDatabase(name);
    this.db.on('populate', transaction => {
      if (!this.seed) return;
      return Promise.all([
        transaction.table('sources').bulkAdd(this.seed.sources.map(record => ({ ...record, nameKey: nameKey(record.name) }))),
        transaction.table('components').bulkAdd(this.seed.components.map(record => ({ ...record, nameKey: nameKey(record.name) }))),
        transaction.table('compositions').bulkAdd(this.seed.compositions.map(record => ({ ...record, nameKey: nameKey(record.name) }))),
      ]).then(() => undefined);
    });
  }
  async open(seed?: Libraries) { this.seed = seed; await this.db.open(); }
  async list(): Promise<Libraries> {
    const strip = <T extends { nameKey: string }>(records: T[]) => records.map(({ nameKey: _key, ...record }) => record);
    return this.db.transaction('r', this.db.tables, async () => ({
      sources: strip(await this.db.sources.orderBy('createdAt').toArray()),
      components: strip(await this.db.components.orderBy('createdAt').toArray()),
      compositions: strip(await this.db.compositions.orderBy('updatedAt').toArray()),
    }));
  }
  async addAsset(kind: 'sources' | 'components', name: string, svgContent: string): Promise<SvgRecord> {
    validateSvgUpload(svgContent);
    const normalized = normalizeName(name, kind);
    const record: SvgRecord = { id: crypto.randomUUID(), name: normalized, svgContent, createdAt: new Date().toISOString() };
    await this.db[kind].add({ ...record, nameKey: nameKey(normalized) });
    return record;
  }
  async saveComposition(project: CompositionProject, expectedRevision: string | null = null): Promise<StoredComposition> {
    if (project.schemaVersion !== 1 || project.width !== 1200 || project.height !== 800 || !project.id || !project.instances.length) throw new Error('Нужна непустая композиция формата 1200 × 800.');
    const ids = new Set<string>();
    for (const item of project.instances) {
      if (!item.id || !item.componentId || ids.has(item.id) || ![item.x, item.y, item.scaleX, item.scaleY, item.rotation, item.zIndex].every(Number.isFinite) || item.scaleX <= 0 || item.scaleY <= 0 || !Number.isInteger(item.zIndex) || item.zIndex < 0) throw new Error('Некорректные данные экземпляра композиции.');
      validateSvgUpload(item.svgContent); assertInstanceGeometry(item); ids.add(item.id);
    }
    const record: StoredComposition = {
      schemaVersion: 1, id: project.id, name: normalizeName(project.name, 'compositions'), width: 1200, height: 800,
      instances: [...project.instances].sort((a, b) => a.zIndex - b.zIndex).map((item, index) => ({
        id: item.id, componentId: item.componentId, svgContent: item.svgContent,
        x: item.x, y: item.y, scaleX: item.scaleX, scaleY: item.scaleY, rotation: item.rotation, zIndex: index,
      })), updatedAt: new Date().toISOString(),
    };
    await this.db.transaction('rw', this.db.compositions, async () => {
      const previous = await this.db.compositions.get(project.id);
      if (expectedRevision === null ? !!previous : !previous || previous.updatedAt !== expectedRevision) throw new CompositionConflictError();
      // Monotonic even for consecutive writes within one millisecond or a clock adjustment.
      record.updatedAt = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
      await this.db.compositions.put({ ...record, nameKey: nameKey(record.name) });
    });
    return record;
  }
  async remove(kind: LibraryKind, id: string) { await this.db[kind].delete(id); }
}

async function fileRequest<T>(body?: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch('/api/project-library', body === undefined ? { cache: 'no-store' } : { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) }); }
  catch { throw new Error('Нет связи с локальным сервером файлов. Проверьте, что проект запущен; данные не сохранены.'); }
  let value;
  try { value = await response.json(); } catch { throw new Error('API файлов проекта недоступен. Запустите npm run dev или npm run preview.'); }
  if (!response.ok) {
    if (value.name === 'CompositionConflictError') throw new CompositionConflictError();
    throw Object.assign(new Error(value.message || 'Не удалось записать файлы проекта.'),{name:value.name || 'Error'});
  }
  return value as T;
}

export class FileStorageService extends StorageService {
  override async open(seed?: Libraries) { if(seed) await fileRequest({action:'initialize',seed}); }
  override async list(): Promise<Libraries> {
    const result=await fileRequest<{initialized:boolean;libraries:Libraries|null}>();
    if(!result.initialized || !result.libraries) throw new Error('Файлы проекта ещё не инициализированы.');
    return result.libraries;
  }
  async state() { return fileRequest<{initialized:boolean;libraries:Libraries|null}>(); }
  async importLegacy(seed: Libraries) { await fileRequest({action:'initialize',seed,legacy:true}); }
  override async addAsset(kind:'sources'|'components', name:string, svgContent:string): Promise<SvgRecord> {
    validateSvgUpload(svgContent);
    return fileRequest({action:'add',kind,name:normalizeName(name,kind),content:svgContent});
  }
  override async saveComposition(project:CompositionProject,expectedRevision:string|null=null): Promise<StoredComposition> {
    for(const item of project.instances) {validateSvgUpload(item.svgContent);assertInstanceGeometry(item);}
    return fileRequest({action:'save',project,expectedRevision});
  }
  override async remove(kind:LibraryKind,id:string) { await fileRequest({action:'remove',kind,id}); }
}
// Named StorageService instances retain IndexedDB for migration and isolated legacy tests.
export const storage = import.meta.env.MODE === 'test-browser' || import.meta.env.MODE === 'test'
  ? new StorageService() : new FileStorageService();
export let legacyStorageWarning = '';
let opening: Promise<void> | null = null;
export function initializeStorage() {
  if (!opening) opening = (async () => {
    if (storage instanceof FileStorageService) {
      const state=await storage.state();
      let imported: Libraries | undefined;
      try {
        if(await LibraryDatabase.exists(storage.db.name)) {
          const legacy=new StorageService();
          try {await legacy.open();imported=await legacy.list();}
          finally {legacy.db.close();}
        }
      } catch {
        legacyStorageWarning='Прежнее хранилище браузера недоступно для переноса. Файлы проекта работают; старые данные не удалены. Для переноса разрешите IndexedDB и перезагрузите страницу.';
      }
      if(imported) {await storage.importLegacy(imported);return;}
      if(state.initialized) return;
    } else if (await LibraryDatabase.exists(storage.db.name)) { await storage.open(); return; }
    // Fetch before opening the populate transaction. No network awaits inside IndexedDB.
    const names = ['peep-sitting-7.svg', 'peep-sitting-10.svg', 'peep-standing-24.svg'];
    const contents = await Promise.all(names.map(async name => {
      const response = await fetch(`/demo/${name}`);
      if (!response.ok) throw new Error(`Не удалось прочитать начальный образец: ${name}`);
      return response.text();
    }));
    const createdAt = new Date().toISOString();
    const sources = names.map((name, index) => ({ id: `source-${index + 1}`, name, svgContent: contents[index], createdAt }));
    const componentNames = ['Сидящий персонаж.svg', 'Персонаж с пучком.svg', 'Танцующий персонаж.svg'];
    const components = sources.map((record, index) => ({ ...record, id: `component-${index + 1}`, name: componentNames[index] }));
    const compositions: StoredComposition[] = [{ schemaVersion: 1, id: 'composition-1', name: 'Три характера.json', width: 1200, height: 800, updatedAt: createdAt,
      instances: components.map((record, index) => ({ id: crypto.randomUUID(), componentId: record.id, svgContent: record.svgContent, x: 160 + index * 270, y: 150, scaleX: 1, scaleY: 1, rotation: 0, zIndex: index })),
    }];
    await storage.open({ sources, components, compositions });
  })().catch(reason => { opening = null; throw reason; });
  return opening;
}
