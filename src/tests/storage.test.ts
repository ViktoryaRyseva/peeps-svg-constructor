import { afterEach, expect, it } from 'vitest';
import { StorageService } from '../services/storage';
import { readSvgFiles } from '../services/svgUpload';
import type { CompositionProject } from '../types/project';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 40"><rect width="30" height="40" fill="#ba4222"/></svg>';
const services: StorageService[] = [];
async function service(name = `peeps-storage-test-${crypto.randomUUID()}`) { const value = new StorageService(name); services.push(value); await value.open(); return value; }
afterEach(async () => { const values = services.splice(0); values.forEach(value => value.db.close()); await Promise.all(values.map(value => value.db.delete())); });
const project = (): CompositionProject => ({ schemaVersion: 1, id: crypto.randomUUID(), name: 'Сцена', width: 1200, height: 800,
  instances: [{ id: crypto.randomUUID(), componentId: 'missing-component-is-allowed', svgContent: svg, x: 20, y: 30, scaleX: 1.5, scaleY: .7, rotation: 25, zIndex: 7 }],
});

it('reads actual file text, accepts uppercase extension and isolates invalid files', async () => {
  const result = await readSvgFiles([
    new File([svg], 'real.SVG'), new File([svg], 'wrong.png'), new File(['<svg><g></svg>'], 'bad.svg'),
    new File(['<html/>'], 'not-svg.svg'), new File(['<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'], 'active.svg'),
  ]);
  expect(result.valid).toHaveLength(1); expect(result.valid[0].svgContent).toBe(svg);
  expect(result.errors).toHaveLength(4);
});

it('persists exact SVG contents and reads them after database reopens', async () => {
  const storage = await service(); const record = await storage.addAsset('sources', 'Мой файл.svg', svg);
  storage.db.close(); const reopened = await service(storage.db.name);
  expect((await reopened.list()).sources).toEqual([record]);
  expect((await reopened.list()).sources[0].svgContent).toBe(svg);
  expect('nameKey' in (await reopened.list()).sources[0]).toBe(false);
});

it('unique index handles concurrent writes and Unicode/case normalization', async () => {
  const storage = await service();
  const results = await Promise.allSettled([storage.addAsset('sources', 'Élan.svg', svg), storage.addAsset('sources', ' E\u0301LAN.SVG ', svg)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  expect((await storage.list()).sources).toHaveLength(1);
  await storage.addAsset('components', 'élan', svg);
  expect((await storage.list()).components).toHaveLength(1);
});

it('deleting source/component does not change autonomous saved composition', async () => {
  const storage = await service(), source = await storage.addAsset('sources', 'Исходник', svg), component = await storage.addAsset('components', 'Деталь', svg);
  const value = project(); value.instances[0].componentId = component.id;
  const saved = await storage.saveComposition(value);
  expect(saved.instances[0].zIndex).toBe(0);
  await storage.remove('components', component.id); await storage.remove('sources', source.id);
  const libraries = await storage.list();
  expect(libraries.sources).toHaveLength(0); expect(libraries.components).toHaveLength(0);
  expect(libraries.compositions[0]).toEqual(saved);
  expect(libraries.compositions[0].instances[0].svgContent).toBe(svg);
  expect(libraries.compositions[0].instances[0].rotation).toBe(25);
});

it('composition overwrite is atomic on duplicate name and keeps previous version', async () => {
  const storage = await service(), a = project(), b = project(); b.name = 'Другая';
  const savedA = await storage.saveComposition(a); await storage.saveComposition(b);
  await expect(storage.saveComposition({ ...a, name: b.name }, savedA.updatedAt)).rejects.toMatchObject({ name: 'ConstraintError' });
  const records = (await storage.list()).compositions;
  expect(records.find(value => value.id === a.id)?.name).toBe('Сцена.json');
  expect(records).toHaveLength(2);
});

it('rejects empty, invalid, duplicate-instance and nonfinite projects without saving', async () => {
  const storage = await service(), valid = project();
  for (const invalid of [
    { ...valid, instances: [] }, { ...valid, width: 400 },
    { ...valid, instances: [valid.instances[0], valid.instances[0]] },
    { ...valid, instances: [{ ...valid.instances[0], x: NaN }] },
  ]) await expect(storage.saveComposition(invalid)).rejects.toThrow();
  expect((await storage.list()).compositions).toHaveLength(0);
});

it('atomically rejects stale concurrent saves and keeps the successful revision', async () => {
  const storage = await service(), value = project();
  const initial = await storage.saveComposition(value);
  const results = await Promise.allSettled([111, 222].map(x => storage.saveComposition({ ...value, instances: [{ ...value.instances[0], x }] }, initial.updatedAt)));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  const saved = (await storage.list()).compositions[0];
  expect(saved.updatedAt > initial.updatedAt).toBe(true);
  await expect(storage.saveComposition(value, initial.updatedAt)).rejects.toMatchObject({ name: 'CompositionConflictError' });
  expect((await storage.list()).compositions[0]).toEqual(saved);
});

it('does not resurrect a composition deleted while another tab was editing', async () => {
  const storage = await service(), value = project();
  const initial = await storage.saveComposition(value);
  await storage.remove('compositions', value.id);
  await expect(storage.saveComposition(value, initial.updatedAt)).rejects.toMatchObject({ name: 'CompositionConflictError' });
  expect((await storage.list()).compositions).toHaveLength(0);
});

it('retries failed first initialization without duplicating populate handlers', async () => {
  const storage = new StorageService(`peeps-storage-test-${crypto.randomUUID()}`); services.push(storage);
  const record = { id: 'same', name: 'Пример.svg', svgContent: svg, createdAt: new Date().toISOString() };
  await expect(storage.open({ sources: [record, record], components: [], compositions: [] })).rejects.toThrow();
  await storage.open({ sources: [record], components: [], compositions: [] });
  expect((await storage.list()).sources).toHaveLength(1);
});
