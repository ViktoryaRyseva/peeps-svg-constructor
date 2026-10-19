import type { AssetView as Asset, CompositionView as DemoComposition, EditorDocument as Document, InstanceView } from '../types/editor';
import type { CompositionProject, StoredComposition, SvgRecord } from '../types/project';
import type { CompositionSnapshot } from '../types/editor';
import { svgSize } from './transforms';
import { inspectSvg } from './svgCompatibility';

const unavailable = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="none" stroke="#9a8d70" stroke-width="4" d="M20 20L80 80M80 20L20 80"/></svg>';
export const svgImage = (svgContent: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(inspectSvg(svgContent).safePreview ? svgContent : unavailable)}`;
export const assetView = (record: SvgRecord): Asset => ({ id: record.id, name: record.name, svgContent: record.svgContent, image: svgImage(record.svgContent), compatibility: inspectSvg(record.svgContent) });
export const compositionView = (project: StoredComposition, components: SvgRecord[] = []): DemoComposition => ({ id: project.id, name: project.name, revision: project.updatedAt,
  items: project.instances.map(item => ({ id: item.componentId, name: components.find(component => component.id === item.componentId)?.name ?? `Компонент ${item.zIndex + 1}.svg`, svgContent: item.svgContent, image: svgImage(item.svgContent), instanceId: item.id, x: item.x, y: item.y, scaleX: item.scaleX, scaleY: item.scaleY, rotation: item.rotation })),
});
export function projectFromDocument(doc: Extract<Document, { mode: 'composition' }>, name: string): CompositionProject {
  return { schemaVersion: 1, id: doc.id ?? crypto.randomUUID(), name, width: 1200, height: 800,
    instances: doc.items.map((item, index) => ({ id: item.instanceId, componentId: item.id, svgContent: item.svgContent, x: item.x, y: item.y, scaleX: item.scaleX, scaleY: item.scaleY, rotation: item.rotation, zIndex: index })),
  };
}

export const makeInstances = (assets: Asset[], offset = 0): InstanceView[] => assets.map((asset, index) => {
  const { compatibility: _compatibility, ...base } = asset;
  const size = svgSize(asset.svgContent), rows = Math.max(1, Math.floor((800 - 150 - size.height) / 60) + 1);
  return { ...base, instanceId: crypto.randomUUID(), x: Math.max(0, Math.min(160 + (index + offset) % 3 * 270, 1200 - size.width)),
    y: Math.max(0, Math.min(150 + Math.floor((index + offset) / 3) % rows * 60, 800 - size.height)), scaleX: 1, scaleY: 1, rotation: 0 };
});
const snapshotKeys = ['id', 'name', 'instanceId', 'svgContent', 'x', 'y', 'scaleX', 'scaleY', 'rotation'] as const;
export const snapshot = (items: readonly InstanceView[]): CompositionSnapshot => items.map(item => ({
  id:item.id, name:item.name, instanceId:item.instanceId, svgContent:item.svgContent,
  x:item.x, y:item.y, scaleX:item.scaleX, scaleY:item.scaleY, rotation:item.rotation,
}));
/** Strings remain immutable shared references; never serialize SVGs on pointermove. */
export const matchesSnapshot = (items: readonly InstanceView[], baseline: CompositionSnapshot) => items.length === baseline.length
  && items.every((item, index) => snapshotKeys.every(key => item[key] === baseline[index][key]));
