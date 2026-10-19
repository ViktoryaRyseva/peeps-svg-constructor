import { useState } from 'react';
import type { AssetView, CompositionView, EditorDocument } from '../types/editor';
import type { LibraryKind } from '../types/project';
import Icon from './Icon';
import { geometry } from '../services/transforms';
import s from '../App.module.css';

const libraryNames: Record<LibraryKind, string> = { sources: 'Исходники', components: 'Компоненты', compositions: 'Композиции' };
export default function LibraryPanel({ sources, components, compositions, doc, onOpen, onDelete }: {
  sources: AssetView[]; components: AssetView[]; compositions: CompositionView[]; doc: EditorDocument;
  onOpen: (kind: LibraryKind, item: AssetView | CompositionView) => void;
  onDelete: (kind: LibraryKind, item: AssetView | CompositionView) => void;
}) {
  const [expanded, setExpanded] = useState<Record<LibraryKind, boolean>>({ sources: true, components: true, compositions: true });
  const entries = { sources, components, compositions };
  return <aside className={s.sidebar} aria-label="Библиотеки">
    <div className={s.sidebarTitle}><span>Библиотека</span><span className={s.totalCount}>{sources.length + components.length + compositions.length}</span></div>
    <div className={s.librarySections}>{(['sources', 'components', 'compositions'] as LibraryKind[]).map(kind => <section className={s.librarySection} key={kind}>
      <button className={s.folderButton} aria-expanded={expanded[kind]} onClick={() => setExpanded(previous => ({ ...previous, [kind]: !previous[kind] }))}><Icon name="chevron" size={12} style={{ transform: expanded[kind] ? 'rotate(90deg)' : undefined }} /><Icon name={kind === 'sources' ? 'folder' : kind === 'components' ? 'component' : 'composition'} size={17} /><span>{libraryNames[kind]}</span><small>{entries[kind].length}</small></button>
      {expanded[kind] && <div className={s.fileList} role="group" aria-label={`Файлы: ${libraryNames[kind]}`}>{entries[kind].map(item => {
        const active = kind === 'sources' && doc.mode === 'source' && doc.asset.id === item.id || kind === 'compositions' && doc.mode === 'composition' && doc.id === item.id;
        return <div className={`${s.fileRow} ${active ? s.activeFile : ''}`} key={item.id}>
          <button className={s.fileOpen} onDoubleClick={() => onOpen(kind, item)} onKeyDown={event => { if (event.key === 'Enter') onOpen(kind, item); }} aria-label={`Открыть ${item.name}`} title="Двойной клик, чтобы открыть"><Icon name="file" size={15} /><span>{item.name}</span>{'compatibility' in item && item.compatibility?.reason && <small className={s.compatibilityBadge} title={item.compatibility.reason}>Только просмотр</small>}</button>
          <button className={s.fileDelete} onClick={() => onDelete(kind, item)} aria-label={`Удалить ${item.name}`}><Icon name="trash" size={14} /></button>
          <div className={s.hoverPreview}>{'image' in item ? <img src={item.image} alt={`Превью ${item.name}`} /> : <div className={s.scenePreview} role="img" aria-label={`Превью ${item.name}`}>{item.items.map(instance => <span className={s.sceneItem} key={instance.instanceId} style={{ left: `${instance.x / 12}%`, top: `${instance.y / 8}%`, width: `${geometry(instance).width / 12}%`, height: `${geometry(instance).height / 8}%`, transform: `rotate(${instance.rotation}deg)` }}><img src={instance.image} alt="" style={{width:`${100/instance.scaleX}%`,height:`${100/instance.scaleY}%`,transform:`scale(${instance.scaleX},${instance.scaleY})`,transformOrigin:'0 0'}} /></span>)}</div>}<span>{item.name}</span></div>
        </div>;
      })}{!entries[kind].length && <p className={s.libraryEmpty}>Пока нет файлов</p>}</div>}
    </section>)}</div>
    <div className={s.sidebarBottom}><div className={s.localIcon}><Icon name="info" size={17} /></div><div><strong>Пространство для идей</strong><p>Открывайте иллюстрации.<br />Собирайте что-то своё.</p></div></div>
  </aside>;
}
