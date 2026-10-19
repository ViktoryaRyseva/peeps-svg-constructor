import { create } from 'zustand';
import type { EditorDocument as Document } from '../types/editor';

type Update<T> = T | ((previous: T) => T);
interface EditorState {
  doc: Document;
  selected: string[];
  regions: string[];
  zoom: number;
  setDoc: (next: Update<Document>) => void;
  setSelected: (next: Update<string[]>) => void;
  setRegions: (next: Update<string[]>) => void;
  setZoom: (next: Update<number>) => void;
}
const resolve = <T>(next: Update<T>, previous: T) => typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;

export const useEditorStore = create<EditorState>(set => ({
  doc: { mode: 'empty' }, selected: [], regions: [], zoom: 100,
  setDoc: next => set(state => ({ doc: resolve(next, state.doc) })),
  setSelected: next => set(state => ({ selected: resolve(next, state.selected) })),
  setRegions: next => set(state => ({ regions: resolve(next, state.regions) })),
  setZoom: next => set(state => ({ zoom: resolve(next, state.zoom) })),
}));
