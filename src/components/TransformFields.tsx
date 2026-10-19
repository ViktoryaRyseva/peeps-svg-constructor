import { useState } from 'react';
import type { InstanceView } from '../types/editor';
import { assertInstanceGeometry, geometry, resizeInstance, rotate } from '../services/transforms';
import s from '../App.module.css';

export default function TransformFields({item,onChange}:{item:InstanceView;onChange:(item:InstanceView)=>void}) {
  const [error,setError]=useState(''),box=geometry(item);
  return <div className={s.transformFields}><span className={s.toolCaption}>ТРАНСФОРМАЦИЯ</span><div className={s.fieldGrid}>
    {([['X',item.x],['Y',item.y],['Ширина',box.width],['Высота',box.height],['Поворот',item.rotation]] as const).map(([label,value])=> {
      const display=String(Number(value.toFixed(3)));
      return <label key={label}>{label}<input key={`${item.instanceId}-${value}`} type="number" step="any" min={label==='Ширина'||label==='Высота'?.01:undefined}
        defaultValue={display} onKeyDown={event=>{if(event.key==='Enter') event.currentTarget.blur();}}
        onBlur={event=> {
          if(event.currentTarget.value===display) return;
          const number=Number(event.currentTarget.value);
          if(!event.currentTarget.value.trim() || !Number.isFinite(number) || ((label==='Ширина'||label==='Высота')&&number<.01)) {
            setError('Введите конечное число; размер должен быть не меньше 0,01.'); event.currentTarget.value=display; return;
          }
          try {
            const next = label==='X' ? {...item,x:number} : label==='Y' ? {...item,y:number} : label==='Поворот' ? {...item,rotation:number}
              : resizeInstance(item,label==='Ширина'?'e':'s',rotate({x:label==='Ширина'?number-box.width:0,y:label==='Высота'?number-box.height:0},item.rotation));
            assertInstanceGeometry(next); setError(''); onChange(next);
          } catch (reason) { setError((reason as Error).message); event.currentTarget.value=display; }
        }}/></label>;
    })}
    </div>{error&&<p className={s.sourceError} role="alert">{error}</p>}</div>;
}
