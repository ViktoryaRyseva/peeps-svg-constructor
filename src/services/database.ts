import Dexie, { type EntityTable } from 'dexie';
import type { IndexedRecord, SvgRecord, StoredComposition } from '../types/project';

export class LibraryDatabase extends Dexie {
  sources!: EntityTable<IndexedRecord<SvgRecord>, 'id'>;
  components!: EntityTable<IndexedRecord<SvgRecord>, 'id'>;
  compositions!: EntityTable<IndexedRecord<StoredComposition>, 'id'>;
  constructor(name = 'peeps-svg-constructor') {
    super(name);
    this.version(1).stores({
      sources: 'id, &nameKey, createdAt',
      components: 'id, &nameKey, createdAt',
      compositions: 'id, &nameKey, updatedAt',
    });
  }
}
