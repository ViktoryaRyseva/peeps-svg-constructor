import { useEffect, useRef, type PointerEvent } from 'react';
import { flushSync } from 'react-dom';
import type { InstanceView } from '../types/editor';
import { angleDelta, geometry, handles, resizeInstance, rotationAt, svgSize, svgTransform, type Handle, type Point } from '../services/transforms';
import s from '../App.module.css';

interface Props { items: InstanceView[]; selected: string[]; onSelect: (ids:string[])=>void; onChange: (items:InstanceView[])=>void; onError: (message:string)=>void }
type Gesture = { mode:'move'|'rotate'|Handle; id:string; pointerId:number; start:Point; items:InstanceView[]; ids:string[]; moved:boolean; shift:boolean; previousAngle:number; angle:number };
export default function CompositionCanvas({items,selected,onSelect,onChange,onError}:Props) {
  const root=useRef<HTMLDivElement>(null), gesture=useRef<Gesture|null>(null);
  const live=useRef({items,selected,onSelect,onChange}); live.current={items,selected,onSelect,onChange};
  function point(event: {clientX:number;clientY:number}) {
    const box=root.current!.getBoundingClientRect();
    return {x:(event.clientX-box.left)*1200/box.width,y:(event.clientY-box.top)*800/box.height};
  }
  function begin(event:PointerEvent, item:InstanceView, mode:Gesture['mode']) {
    if(event.button!==0 || gesture.current) return;
    event.preventDefault(); event.stopPropagation();
    // Commit a pending field blur before taking the gesture snapshot. Otherwise
    // the first pointer move could restore the object's pre-edit dimensions.
    flushSync(()=>{ (event.currentTarget as HTMLElement).focus({preventScroll:true}); });
    const initial=live.current.items, current=live.current.selected;
    item=initial.find(value=>value.instanceId===item.instanceId)!;
    const already=current.includes(item.instanceId);
    const ids=mode!=='move' ? [item.instanceId] : event.shiftKey ? already ? current.filter(id=>id!==item.instanceId) : [...current,item.instanceId] : already ? current : [item.instanceId];
    onSelect(ids);
    if(!ids.includes(item.instanceId)) return;
    const start=point(event), box=geometry(item), angle=rotationAt({x:box.cx,y:box.cy},start);
    gesture.current={mode,id:item.instanceId,pointerId:event.pointerId,start,items:initial,ids,moved:false,shift:event.shiftKey,previousAngle:angle,angle:item.rotation};
    root.current!.setPointerCapture(event.pointerId);
  }
  function move(event:PointerEvent) {
    const active=gesture.current; if(!active || event.pointerId!==active.pointerId) return;
    const now=point(event), delta={x:now.x-active.start.x,y:now.y-active.start.y};
    if(!active.moved && Math.hypot(delta.x,delta.y)*root.current!.getBoundingClientRect().width/1200<2) return;
    active.moved=true;
    const item=active.items.find(value=>value.instanceId===active.id)!;
    if(active.mode==='rotate') {
      const box=geometry(item), angle=rotationAt({x:box.cx,y:box.cy},now);
      active.angle+=angleDelta(active.previousAngle,angle); active.previousAngle=angle;
    }
    try { onChange(active.items.map(value=> {
      if(active.mode==='move') return active.ids.includes(value.instanceId) ? {...value,x:value.x+delta.x,y:value.y+delta.y} : value;
      if(value.instanceId!==active.id) return value;
      if(active.mode==='rotate') return {...value,rotation:active.angle};
      return resizeInstance(value,active.mode,delta);
    })); } catch (reason) { onError((reason as Error).message); }
  }
  function end(event:PointerEvent) {
    const active=gesture.current; if(!active || active.pointerId!==event.pointerId) return;
    move(event); gesture.current=null;
    if(!active.moved && !active.shift && active.mode==='move') onSelect([active.id]);
    if(root.current!.hasPointerCapture(event.pointerId)) root.current!.releasePointerCapture(event.pointerId);
  }
  function cancel() { const active=gesture.current; gesture.current=null; if(active) live.current.onChange(active.items); }
  useEffect(()=> {
    const key=(event:KeyboardEvent)=> {
      if(event.key!=='Escape' || document.querySelector('dialog[open]')) return;
      if(gesture.current) cancel(); else live.current.onSelect([]);
    };
    document.addEventListener('keydown',key); return ()=>document.removeEventListener('keydown',key);
  },[]);
  const styleFor=(item:InstanceView)=> {
    const size=svgSize(item.svgContent);
    return {left:item.x*.6,top:item.y*.6,width:size.width*item.scaleX*.6,height:size.height*item.scaleY*.6,transform:`rotate(${item.rotation}deg)`};
  };
  return <div ref={root} className={s.compositionCanvas} data-testid="composition-canvas" onClick={event=>event.stopPropagation()}
    onPointerDown={event=>{if(event.target===event.currentTarget && !event.shiftKey) onSelect([]);}}
    onPointerMove={move} onPointerUp={end} onPointerCancel={cancel} onLostPointerCapture={cancel}>
    {items.map((item,index)=> {
      const chosen=selected.includes(item.instanceId);
      return <div key={item.instanceId} data-testid="instance" data-instance-id={item.instanceId} data-svg-transform={svgTransform(item)} className={s.instance}
        style={styleFor(item)}>
        <button className={s.instanceHit} aria-label={`Выделить экземпляр ${index+1}: ${item.name}`} aria-pressed={chosen}
          onDragStart={event=>event.preventDefault()} onPointerDown={event=>begin(event,item,'move')}
          onClick={event=>{event.stopPropagation();if(event.detail===0) onSelect(event.shiftKey ? chosen ? selected.filter(id=>id!==item.instanceId) : [...selected,item.instanceId] : [item.instanceId]);}}>
          <img src={item.image} draggable={false} alt="" style={{width:`${100/item.scaleX}%`,height:`${100/item.scaleY}%`,transform:`scale(${item.scaleX},${item.scaleY})`,transformOrigin:'0 0'}} />
        </button>
      </div>;
    })}
    {items.filter(item=>selected.includes(item.instanceId)).map(item=><div key={item.instanceId} className={`${s.instance} ${s.frameHost}`} style={styleFor(item)}>
        <div className={s.transformFrame}>
          <span className={s.selectionLabel}>{item.name.replace(/\.svg$/i,'')}</span>
          {selected.length===1 && <>{(Object.entries(handles) as [Handle,Point][]).map(([handle,direction])=><button key={handle} type="button" aria-label={`Масштабировать: ${handle}`} data-handle={handle}
            className={s.resizeHandle} style={{left:`${(direction.x+1)*50}%`,top:`${(direction.y+1)*50}%`,cursor:direction.x&&direction.y ? direction.x===direction.y?'nwse-resize':'nesw-resize':direction.x?'ew-resize':'ns-resize'}}
            onPointerDown={event=>begin(event,item,handle)}/>) }
            <button type="button" aria-label="Повернуть экземпляр" className={s.rotationHandle} onPointerDown={event=>begin(event,item,'rotate')}>↻</button>
          </>}
        </div>
      </div>)}
  </div>;
}
