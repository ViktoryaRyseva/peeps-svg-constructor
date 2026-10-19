export type LibraryKind = 'sources' | 'components' | 'compositions';
export interface SvgRecord { id: string; name: string; svgContent: string; createdAt: string }
export interface ComponentInstance {
  id: string;
  componentId: string;
  svgContent: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  zIndex: number;
}
export interface CompositionProject {
  schemaVersion: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  instances: ComponentInstance[];
}
export interface StoredComposition extends CompositionProject { updatedAt: string }
export type IndexedRecord<T> = T & { nameKey: string };
export type Libraries = { sources: SvgRecord[]; components: SvgRecord[]; compositions: StoredComposition[] };
