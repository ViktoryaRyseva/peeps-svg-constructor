import { expect, it } from 'vitest';
import { angleDelta, geometry, handlePoint, handles, resizeInstance, svgSize, svgTransform, type Handle } from '../services/transforms';
import { makeInstances, projectFromDocument, compositionView, snapshot } from '../services/views';
import type { InstanceView } from '../types/editor';

const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50"/></svg>';
const item:InstanceView={id:'asset',instanceId:'one',name:'A.svg',svgContent:svg,image:'unused',x:100,y:100,scaleX:1,scaleY:1,rotation:0};
it('uses actual SVG proportions including negative viewBox origins and tiny details',()=> {
  expect(svgSize(svg)).toEqual({width:100,height:50});
  expect(svgSize(svg.replace('0 0 100 50','-20 -10 3 8'))).toEqual({width:3,height:8});
});
for(const angle of [0,37,135]) for(const handle of Object.keys(handles) as Handle[]) it(`keeps opposite anchor fixed at ${angle}° / ${handle}`,()=> {
  const before={...item,rotation:angle,scaleX:1.4,scaleY:.7}, dir=handles[handle];
  const opposite=Object.keys(handles).find(key=>handles[key as Handle].x===-dir.x&&handles[key as Handle].y===-dir.y) as Handle;
  const anchor=handlePoint(before,opposite), result=resizeInstance(before,handle,{x:13,y:7}), after=handlePoint(result,opposite);
  expect(after.x).toBeCloseTo(anchor.x,10); expect(after.y).toBeCloseTo(anchor.y,10);
  if(dir.x&&dir.y) expect(result.scaleX/result.scaleY).toBeCloseTo(before.scaleX/before.scaleY,10);
  else if(dir.x) expect(result.scaleY).toBe(before.scaleY); else expect(result.scaleX).toBe(before.scaleX);
  expect(result.svgContent).toBe(svg); expect(before).not.toBe(result);
});
it('matches an independently calculated rotated corner at 90°',()=> {
  const result=resizeInstance({...item,rotation:90},'se',{x:-25,y:50});
  expect(result.x).toBeCloseTo(62.5,10);expect(result.y).toBeCloseTo(112.5,10);
  expect(result.scaleX).toBeCloseTo(1.5,10);expect(result.scaleY).toBeCloseTo(1.5,10);
});
it('matches an independently calculated rotated side at 90°',()=> {
  const result=resizeInstance({...item,rotation:90},'e',{x:0,y:50});
  expect(result.x).toBeCloseTo(75,10);expect(result.y).toBeCloseTo(125,10);
  expect(result.scaleX).toBeCloseTo(1.5,10);expect(result.scaleY).toBe(1);
});
it('stops at positive size when the pointer crosses the opposite edge',()=> {
  const result=resizeInstance(item,'e',{x:-1000,y:0});
  expect(geometry(result).width).toBeCloseTo(.01,10);expect(result.x).toBe(100);expect(result.scaleY).toBe(1);
});
it('unwraps rotation across the angle seam in both directions',()=> {
  expect(angleDelta(179,-179)).toBe(2);expect(angleDelta(-179,179)).toBe(-2);
});
it('serializes the same center and corner into an actual SVG transform',()=> {
  const group=document.createElementNS('http://www.w3.org/2000/svg','g');
  group.setAttribute('transform',svgTransform({...item,rotation:90}));
  const matrix=group.transform.baseVal.consolidate()!.matrix;
  const center=new DOMPoint(50,25).matrixTransform(matrix), corner=new DOMPoint(0,0).matrixTransform(matrix);
  expect(center.x).toBeCloseTo(150,10);expect(center.y).toBeCloseTo(125,10);
  expect(corner.x).toBeCloseTo(175,10);expect(corner.y).toBeCloseTo(75,10);
});
it('preserves independent parameters and order across project serialization',()=> {
  const second={...item,instanceId:'two',rotation:37,scaleX:1.3,scaleY:.4,x:12.123456789,y:-42.987654321};
  const items=[item,second]; const project=projectFromDocument({mode:'composition',name:'Scene',items,baseline:null},'Scene');
  const reopened=compositionView({...project,updatedAt:''}).items;
  expect(reopened.map(({x,y,rotation,scaleX,scaleY})=>({x,y,rotation,scaleX,scaleY}))).toEqual(items.map(({x,y,rotation,scaleX,scaleY})=>({x,y,rotation,scaleX,scaleY})));
  expect(project.instances.map(value=>value.zIndex)).toEqual([0,1]); expect(project.instances[1].svgContent).toBe(svg);
  expect(JSON.stringify(snapshot(items))).not.toContain('unused');
});
it('adds independent copies in chosen order and offsets appended batches',()=> {
  const assets=[{id:'b',name:'B',svgContent:svg,image:''},{id:'a',name:'A',svgContent:svg,image:''}];
  const added=makeInstances(assets,3);
  expect(added.map(value=>value.id)).toEqual(['b','a']);expect(added.map(value=>value.y)).toEqual([210,210]);
  expect(added[0].instanceId).not.toBe(added[1].instanceId);
});
