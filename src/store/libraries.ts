import { create } from 'zustand';
import { initializeStorage, storage } from '../services/storage';
import { storageError } from '../services/names';
import type { CompositionProject, Libraries, LibraryKind, StoredComposition } from '../types/project';

interface LibraryState extends Libraries {
  status: 'loading' | 'ready' | 'error';
  error: string;
  load: () => Promise<void>;
  addAsset: (kind: 'sources' | 'components', name: string, content: string) => Promise<void>;
  saveComposition: (project: CompositionProject, expectedRevision?: string | null) => Promise<StoredComposition>;
  remove: (kind: LibraryKind, id: string) => Promise<void>;
}
export const useLibraryStore = create<LibraryState>(set => {
  const refresh = async () => { set({ ...await storage.list(), status: 'ready', error: '' }); };
  return {
    sources: [], components: [], compositions: [], status: 'loading', error: '',
    load: async () => {
      try { await initializeStorage(); await refresh(); }
      catch (reason) { set({ status: 'error', error: storageError(reason) }); }
    },
    addAsset: async (kind, name, content) => {
      const record = await storage.addAsset(kind, name, content);
      set(state => ({ [kind]: [...state[kind], record] }));
    },
    saveComposition: async (project, expectedRevision = null) => {
      const saved = await storage.saveComposition(project, expectedRevision);
      set(state => ({ compositions: [...state.compositions.filter(record => record.id !== saved.id), saved] }));
      return saved;
    },
    remove: async (kind, id) => {
      await storage.remove(kind, id);
      set(state => ({ [kind]: state[kind].filter(record => record.id !== id) }));
    },
  };
});
