import { expect, it } from 'vitest';
import { LibraryDatabase } from '../services/database';
import { useEditorStore } from '../store/editor';

it('opens actual IndexedDB with three tables and unique name indexes', async () => {
  const db = new LibraryDatabase(`peeps-test-${crypto.randomUUID()}`);
  try {
    await db.open();
    expect(db.tables.map(table => table.name).sort()).toEqual(['components', 'compositions', 'sources']);
    expect(db.sources.schema.idxByName.nameKey.unique).toBe(true);
    expect(await db.sources.count()).toBe(0);
  } finally { await db.delete(); }
});

it('Zustand keeps view state independently from saved data', () => {
  useEditorStore.getState().setZoom(125);
  useEditorStore.getState().setSelected(['example-instance']);
  expect(useEditorStore.getState().zoom).toBe(125);
  expect(useEditorStore.getState().selected).toEqual(['example-instance']);
  expect(useEditorStore.getState().doc.mode).toBe('empty');
  useEditorStore.getState().setZoom(100); useEditorStore.getState().setSelected([]);
});
