import type { InstanceView } from '../types/editor';

export type Point = { x: number; y: number };
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const MAX_GEOMETRY = 1_000_000;
export const MAX_ROTATION = 1_000_000_000;
type TransformData = Pick<InstanceView, 'svgContent' | 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation'>;
export const handles: Record<Handle, Point> = { nw:{x:-1,y:-1},n:{x:0,y:-1},ne:{x:1,y:-1},e:{x:1,y:0},se:{x:1,y:1},s:{x:0,y:1},sw:{x:-1,y:1},w:{x:-1,y:0} };
export const rotate = (point: Point, angle: number): Point => {
  const r = (angle % 360) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: point.x*c-point.y*s, y: point.x*s+point.y*c };
};
const sizes = new Map<string, {width:number;height:number}>();
export function svgSize(text: string) {
  const cached = sizes.get(text); if(cached) return cached;
  const root = new DOMParser().parseFromString(text,'image/svg+xml').documentElement;
  const vb = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const width = vb?.[2] ?? Number(root.getAttribute('width')), height = vb?.[3] ?? Number(root.getAttribute('height'));
  const size = Number.isFinite(width) && Number.isFinite(height) && width>0 && height>0 ? {width,height} : {width:250,height:450};
  if(sizes.size >= 256) sizes.clear(); sizes.set(text,size); return size;
}
export function geometry(item: TransformData) {
  const size = svgSize(item.svgContent), width = size.width*item.scaleX, height = size.height*item.scaleY;
  return {width,height,cx:item.x+width/2,cy:item.y+height/2};
}
/** Validate derived geometry too, before changing editor state or storing a project. */
export function assertInstanceGeometry(item: TransformData) {
  const box = geometry(item);
  if (![item.x, item.y, item.scaleX, item.scaleY, item.rotation, box.width, box.height, box.cx, box.cy, 100 / item.scaleX, 100 / item.scaleY].every(Number.isFinite)
    || item.scaleX <= 0 || item.scaleY <= 0 || item.scaleX > 1e9 || item.scaleY > 1e9
    || box.width <= 0 || box.height <= 0 || box.width > MAX_GEOMETRY || box.height > MAX_GEOMETRY
    || Math.abs(item.x) > MAX_GEOMETRY || Math.abs(item.y) > MAX_GEOMETRY || Math.abs(item.rotation) > MAX_ROTATION) {
    throw new Error('Значение слишком велико или даёт некорректную геометрию. Координаты и размеры — до 1 000 000, угол — до 1 000 000 000°.');
  }
}
export function isOutsideCanvas(item: TransformData) {
  const box = geometry(item), r = (item.rotation % 360) * Math.PI / 180;
  const dx = (Math.abs(Math.cos(r)) * box.width + Math.abs(Math.sin(r)) * box.height) / 2;
  const dy = (Math.abs(Math.sin(r)) * box.width + Math.abs(Math.cos(r)) * box.height) / 2;
  return box.cx + dx <= 0 || box.cx - dx >= 1200 || box.cy + dy <= 0 || box.cy - dy >= 800;
}
export function returnToCanvas(item: InstanceView): InstanceView {
  const box = geometry(item);
  return { ...item, x: 600 - box.width / 2, y: 400 - box.height / 2 };
}
export function handlePoint(item: InstanceView, handle: Handle): Point {
  const box = geometry(item), direction = handles[handle];
  const offset = rotate({x:direction.x*box.width/2,y:direction.y*box.height/2},item.rotation);
  return {x:box.cx+offset.x,y:box.cy+offset.y};
}
/** Pointer delta is in canvas units; resize fixes the opposite corner/edge midpoint. */
export function resizeInstance(item: InstanceView, handle: Handle, delta: Point): InstanceView {
  const box = geometry(item), dir = handles[handle], change = rotate(delta,-item.rotation);
  let width = box.width, height = box.height;
  if(dir.x && dir.y) {
    const diagonal = Math.hypot(width, height);
    const factor = Math.max(.01/width,.01/height,1+((dir.x*width/diagonal)*change.x+(dir.y*height/diagonal)*change.y)/diagonal);
    width *= factor; height *= factor;
  } else if(dir.x) width = Math.max(.01,width+dir.x*change.x);
  else height = Math.max(.01,height+dir.y*change.y);
  const shift = rotate({x:dir.x*(width-box.width)/2,y:dir.y*(height-box.height)/2},item.rotation);
  const result = {...item,x:box.cx+shift.x-width/2,y:box.cy+shift.y-height/2,scaleX:item.scaleX*(width/box.width),scaleY:item.scaleY*(height/box.height)};
  assertInstanceGeometry(result); return result;
}
/** Unwrapped incremental angle avoids a jump when crossing -180 / 180 degrees. */
export function angleDelta(previous: number, next: number) { return ((next-previous+540)%360)-180; }
export function rotationAt(center: Point, point: Point) { return Math.atan2(point.y-center.y,point.x-center.x)*180/Math.PI; }
export function svgTransform(item: InstanceView) {
  const box=geometry(item), size=svgSize(item.svgContent);
  return `translate(${box.cx} ${box.cy}) rotate(${item.rotation}) scale(${item.scaleX} ${item.scaleY}) translate(${-size.width/2} ${-size.height/2})`;
}
