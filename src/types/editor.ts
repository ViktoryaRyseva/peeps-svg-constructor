/** Working representations only. Data URLs, baseline and selection are never stored in JSON. */
export type SvgCompatibility = { canExtract: boolean; safePreview: boolean; reason?: string };
export type AssetView = { id: string; name: string; image: string; svgContent: string; compatibility?: SvgCompatibility };
export type InstanceView = AssetView & { instanceId: string; x: number; y: number; scaleX: number; scaleY: number; rotation: number };
export type CompositionView = { id: string; name: string; items: InstanceView[]; revision: string };
export type CompositionSnapshot = readonly Readonly<Pick<InstanceView, 'id' | 'name' | 'instanceId' | 'svgContent' | 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation'>>[];
export type EditorDocument = { mode: 'empty' }
  | { mode: 'source'; asset: AssetView }
  | { mode: 'composition'; id?: string; name: string; items: InstanceView[]; baseline: CompositionSnapshot | null; revision?: string };
