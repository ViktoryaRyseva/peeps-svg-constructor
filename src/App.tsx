import Loader from './components/Loader';
import { yieldForPaint } from './services/paint';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Icon, { type IconName } from './components/Icon';
import Modal from './components/Modal';
import { useEditorStore } from './store/editor';
import type { AssetView as Asset, CompositionView as DemoComposition, InstanceView as DemoInstance, EditorDocument as Document } from './types/editor';
import type { LibraryKind } from './types/project';
import LibraryPanel from './components/LibraryPanel';
import CompositionCanvas from './components/CompositionCanvas';
import TransformFields from './components/TransformFields';
import { useLibraryStore } from './store/libraries';
import { assetView, compositionView, projectFromDocument, makeInstances, snapshot, matchesSnapshot, svgImage } from './services/views';
import type { SourceCanvasHandle, SourceStatus } from './components/SourceCanvas';
import type { ExtractionV2 } from './svg/extract';
import { nameKey, normalizeName, storageError } from './services/names';
import { readSvgFiles, type PendingUpload } from './services/svgUpload';
import { CompositionConflictError, legacyStorageWarning } from './services/storage';
import { downloadComposition, exportComposition, exportFilename } from './services/compositionExport';
import { assertInstanceGeometry, isOutsideCanvas, returnToCanvas } from './services/transforms';
import { inspectSvg } from './services/svgCompatibility';
import s from './App.module.css';

type Dialog = { kind: 'picker'; library: 'sources' | 'components'; adding?: boolean }
  | { kind: 'guard'; proceed: () => void | Promise<void> }
  | { kind: 'name'; library: LibraryKind; commit: (name: string) => Promise<void>; cancel?: () => void; component?: ExtractionV2; warning?: string }
  | { kind: 'confirm'; title: string; description: string; action: string; danger?: boolean; accept: () => void | Promise<void> }
  | { kind: 'upload' }
  | { kind: 'export' };
const empty: Document = { mode: 'empty' };
const SourceCanvas = lazy(() => import('./components/SourceCanvas'));
const toggle = (list: string[], id: string, additive: boolean) => additive ? list.includes(id) ? list.filter(value => value !== id) : [...list, id] : [id];

export default function App() {
  const libraries = useLibraryStore();
  const sources = useMemo(() => libraries.sources.map(assetView), [libraries.sources]);
  const components = useMemo(() => libraries.components.map(assetView), [libraries.components]);
  const compositions = useMemo(() => libraries.compositions.map(project => compositionView(project, libraries.components)), [libraries.compositions, libraries.components]);
  const { doc, setDoc, selected, setSelected, regions, setRegions, zoom, setZoom } = useEditorStore();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saveConflict, setSaveConflict] = useState(false);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [uploadIndex, setUploadIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const readVersion = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const sourceCanvas = useRef<SourceCanvasHandle>(null);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus>({ state: 'loading' });
  const [extractionError, setExtractionError] = useState('');
  const dirty = doc.mode === 'source' ? regions.length > 0 : doc.mode === 'composition'
    && (doc.baseline === null ? doc.items.length > 0 : !matchesSnapshot(doc.items, doc.baseline));
  const outside = doc.mode === 'composition' ? doc.items.filter(isOutsideCanvas) : [];
  const sourceCanExtract = doc.mode !== 'source' || doc.asset.compatibility?.canExtract !== false;
  const nonempty = doc.mode === 'composition' && doc.items.length > 0;
  const entries = { sources, components, compositions };
  const selectionCount = doc.mode === 'source' ? regions.length : selected.length;
  const activeIndex = doc.mode === 'composition' && selected.length === 1 ? doc.items.findIndex(item => item.instanceId === selected[0]) : -1;

  useEffect(() => { void libraries.load(); }, [libraries.load]);
  useEffect(() => { setExtractionError(''); }, [regions]);
  useEffect(() => { if(libraries.status==='ready' && legacyStorageWarning) setNotice(legacyStorageWarning); }, [libraries.status]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!dirty && !busy && !reading) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy, reading]);
  useEffect(() => {
    if (dialog || doc.mode !== 'source') return;
    const clear = (event: KeyboardEvent) => { if (event.key === 'Escape') setRegions([]); };
    document.addEventListener('keydown', clear);
    return () => document.removeEventListener('keydown', clear);
  }, [dialog, doc.mode, setRegions]);

  function closeDialog() { setDialog(null); setError(''); setSaveConflict(false); readVersion.current++; setReading(false); }
  const operationLock = useRef(false);
  async function runOperation(operation: () => void | Promise<void>) {
    if (operationLock.current) return;
    operationLock.current = true; setBusy(true);
    try { await yieldForPaint(); await operation(); }
    catch (reason) { const message = storageError(reason); setSaveConflict(reason instanceof CompositionConflictError); setError(message); setNotice(message); }
    finally { operationLock.current = false; setBusy(false); }
  }
  function openName(library: LibraryKind, commit: (value: string) => Promise<void>, cancel?: () => void, component?: ExtractionV2, warning?: string) {
    const prefix = { sources: 'Исходник', components: 'Компонент', compositions: 'Композиция' }[library];
    let value: string;
    do { value = `${prefix}-${crypto.randomUUID().slice(0, 8)}`; }
    while (entries[library].some(item => nameKey(item.name) === nameKey(normalizeName(value, library))));
    setName(value); setError(''); setSaveConflict(false); setDialog({ kind: 'name', library, commit, cancel, component, warning });
  }
  async function commitName() {
    if (dialog?.kind !== 'name') return;
    let value: string;
    try { value = normalizeName(name, dialog.library); } catch (reason) { setError(storageError(reason)); return; }
    if (entries[dialog.library].some(item => nameKey(item.name) === nameKey(value))) { setError('Такое имя уже есть в этой библиотеке. Выберите другое.'); return; }
    await runOperation(() => dialog.commit(value));
  }
  function openDocument(next: Document) {
    if (next.mode === 'composition') {
      try { next.items.forEach(assertInstanceGeometry); }
      catch (reason) { setError((reason as Error).message); setNotice((reason as Error).message); return; }
    }
    if (next.mode === 'source') setSourceStatus({ state: 'loading' });
    setDoc(next); setSelected([]); setRegions([]); setZoom(100); closeDialog();
  }
  function requestTransition(proceed: () => void | Promise<void>) {
    if (dirty) setDialog({ kind: 'guard', proceed });
    else proceed();
  }
  function openPicker(library: 'sources' | 'components', adding = false) {
    setPicked([]); setDialog({ kind: 'picker', library, adding }); setError('');
  }
  function confirmPicker() {
    if (dialog?.kind !== 'picker' || picked.length === 0) return;
    if (dialog.library === 'sources') {
      const asset = sources.find(item => item.id === picked[0])!;
      if (doc.mode === 'source' && doc.asset.id === asset.id) { closeDialog(); return; }
      requestTransition(() => openDocument({ mode: 'source', asset }));
    } else {
      let items: DemoInstance[];
      try { items = makeInstances(picked.map(id => components.find(item => item.id === id)!), dialog.adding && doc.mode === 'composition' ? doc.items.length : 0); items.forEach(assertInstanceGeometry); }
      catch (reason) { setError((reason as Error).message); return; }
      if (dialog.adding && doc.mode === 'composition') {
        setDoc({ ...doc, items: [...doc.items, ...items] }); setSelected(items.map(item => item.instanceId)); closeDialog();
      } else requestTransition(() => openDocument({ mode: 'composition', name: 'Новая композиция', items, baseline: null }));
    }
  }
  function openLibraryItem(kind: LibraryKind, item: Asset | DemoComposition) {
    if (kind === 'sources') {
      if (doc.mode === 'source' && doc.asset.id === item.id) return;
      requestTransition(() => openDocument({ mode: 'source', asset: item as Asset }));
    } else if (kind === 'compositions') {
      if (doc.mode === 'composition' && doc.id === item.id) return;
      const composition = item as DemoComposition;
      requestTransition(() => openDocument({ mode: 'composition', ...composition, baseline: snapshot(composition.items) }));
    } else setDialog({ kind: 'confirm', title: 'Создать композицию?', description: `Начать новую композицию с компонентом «${item.name}»?`, action: 'Да, создать',
      accept: () => requestTransition(() => openDocument({ mode: 'composition', name: 'Новая композиция', items: makeInstances([item as Asset]), baseline: null })) });
  }
  function saveCurrent(after?: () => void | Promise<void>, alreadyConfirmed = false, asCopy = false) {
    if (doc.mode === 'source' && regions.length > 0) {
      void runOperation(() => { try {
        if (!sourceCanvas.current) throw new Error('Дождитесь открытия исходника.');
        const component = sourceCanvas.current.extract(regions);
        setExtractionError('');
        openName('components', async value => {
          await libraries.addAsset('components', value, component.svg);
          setRegions([]); closeDialog();
          setNotice('Выделение сохранено как самостоятельный SVG-компонент.'); await after?.();
        }, undefined, component);
      } catch (reason) { const message = storageError(reason); setError(message); setExtractionError(message); } });
    } else if (doc.mode === 'composition') {
      if (!doc.items.length) { closeDialog(); setNotice('Для сохранения нужен хотя бы один компонент. Добавьте его или выберите «Не сохранять».'); return; }
      const persist = async (value: string) => {
        const project = projectFromDocument(asCopy ? { ...doc, id: undefined } : doc, value);
        const saved = await libraries.saveComposition(project, asCopy || !doc.id ? null : doc.revision ?? null);
        setDoc({ ...doc, id: saved.id, name: saved.name, revision: saved.updatedAt, baseline: snapshot(doc.items) }); closeDialog();
        setNotice('Композиция сохранена в локальной библиотеке.'); await after?.();
      };
      if (!doc.id || asCopy) openName('compositions', persist);
      else if (alreadyConfirmed) void runOperation(() => persist(doc.name));
      else setDialog({ kind: 'confirm', title: 'Сохранить изменения?', description: `Обновить «${doc.name}»? Предыдущая версия будет заменена.`, action: 'Да, перезаписать', accept: () => persist(doc.name) });
    }
  }
  function exportCurrent() {
    if (doc.mode !== 'composition') return;
    void runOperation(() => {
      const svg = exportComposition(doc.items);
      downloadComposition(svg, exportFilename(doc.name));
      closeDialog(); setNotice('SVG подготовлен и передан браузеру для скачивания.');
    });
  }
  function deleteLibraryItem(kind: LibraryKind, item: Asset | DemoComposition) {
    const active = kind === 'sources' && doc.mode === 'source' && doc.asset.id === item.id
      || kind === 'compositions' && doc.mode === 'composition' && doc.id === item.id;
    const remove = async () => {
      await libraries.remove(kind, item.id);
      if (active) openDocument(empty); else closeDialog();
      setNotice('Запись удалена из локальной библиотеки.');
    };
    setDialog({ kind: 'confirm', title: 'Удалить файл?', description: `«${item.name}» будет удалён из библиотеки.${active && doc.mode === 'composition' && dirty ? ' Текущие несохранённые изменения тоже будут потеряны.' : ''} Это действие нельзя отменить.`, action: 'Удалить', danger: true,
      accept: async () => { if (active && doc.mode === 'source' && dirty) requestTransition(remove); else await remove(); } });
  }
  function updateItems(items: DemoInstance[]) {
    if (doc.mode !== 'composition') return false;
    try { items.forEach(assertInstanceGeometry); setDoc({ ...doc, items }); return true; }
    catch (reason) { setNotice((reason as Error).message); return false; }
  }
  function restoreOutside() {
    if (doc.mode !== 'composition') return;
    const ids = new Set(outside.map(item => item.instanceId));
    if (updateItems(doc.items.map(item => ids.has(item.instanceId) ? returnToCanvas(item) : item))) setSelected([...ids]);
  }
  function duplicate() {
    if (doc.mode !== 'composition') return;
    const copies = doc.items.filter(item => selected.includes(item.instanceId)).map(item => ({ ...item, instanceId: crypto.randomUUID(), x: item.x + 20, y: item.y + 20 }));
    if (updateItems([...doc.items, ...copies])) setSelected(copies.map(item => item.instanceId));
  }
  function removeSelected() {
    if (doc.mode !== 'composition') return;
    updateItems(doc.items.filter(item => !selected.includes(item.instanceId))); setSelected([]);
  }
  function moveLayer(direction: number) {
    if (doc.mode !== 'composition' || activeIndex < 0) return;
    const items = [...doc.items], destination = activeIndex + direction;
    if (destination < 0 || destination >= items.length) return;
    [items[activeIndex], items[destination]] = [items[destination], items[activeIndex]]; updateItems(items);
  }
  async function chooseFiles(files: FileList | null) {
    if (!files) return;
    const version = ++readVersion.current;
    setReading(true); setError(''); setUploads([]);
    try {
      await yieldForPaint();
      if (version !== readVersion.current) return;
      const result = await readSvgFiles(Array.from(files));
      if (version !== readVersion.current) return;
      setUploads(result.valid.map(file => ({ ...file, compatibility: inspectSvg(file.svgContent) }))); setUploadIndex(0); setError(result.errors.join('\n'));
    } catch (reason) { if (version === readVersion.current) setError(storageError(reason)); }
    finally { if (version === readVersion.current) setReading(false); }
  }
  function saveUpload(index: number) {
    const advance = () => {
      const next = index + 1; setUploadIndex(next);
      if (next < uploads.length) setDialog({ kind: 'upload' });
    };
    const pending = uploads[index];
    openName('sources', async value => {
      await libraries.addAsset('sources', value, pending.svgContent);
      closeDialog(); setNotice('SVG сохранён в библиотеке исходников.'); advance();
    }, advance, undefined, pending.compatibility?.reason);
  }

  function action(icon: IconName, label: string, onClick: () => void, disabled = false, className = '') {
    return <button className={`${s.button} ${className}`} disabled={disabled} onClick={onClick}><Icon name={icon} />{label}</button>;
  }
  const docTitle = doc.mode === 'source' ? doc.asset.name : doc.mode === 'composition' ? doc.name : 'Рабочая область';

  let modal: ReactNode = null;
  if (dialog?.kind === 'picker') {
    const isSources = dialog.library === 'sources', options = isSources ? sources : components;
    modal = <Modal busy={busy} title={isSources ? 'Выберите исходник' : 'Выберите компоненты'} subtitle={isSources ? 'Откройте иллюстрацию, чтобы выделить её элементы.' : 'Можно выбрать сразу несколько компонентов.'} onClose={closeDialog} wide
      footer={<><span className={s.dialogMeta}>Выбрано: {picked.length}</span><button className={s.button} disabled={busy} onClick={closeDialog}>Отмена</button><button className={`${s.button} ${s.primary}`} disabled={!picked.length} onClick={confirmPicker}>{isSources ? 'Открыть исходник' : dialog.adding ? 'Добавить на холст' : 'Создать композицию'}</button></>}>
      {options.length ? <div className={s.pickerGrid}>{options.map(item => <label className={`${s.pickerCard} ${picked.includes(item.id) ? s.picked : ''}`} key={item.id}>
        <input type={isSources ? 'radio' : 'checkbox'} name="asset-choice" checked={picked.includes(item.id)} onChange={() => setPicked(isSources ? [item.id] : toggle(picked, item.id, true))} aria-label={`Выбрать ${item.name}`} />
        <div className={s.pickerImage}><img src={item.image} alt="" /></div><span>{item.name}</span>{isSources && item.compatibility?.reason && <small className={s.compatibilityNote}>Только просмотр: {item.compatibility.reason}</small>}
      </label>)}</div> : <div className={s.modalEmpty}><Icon name="folder" size={32} /><h3>В библиотеке пока пусто</h3><p>{isSources ? 'Загрузите SVG, затем вернитесь к выбору исходника.' : 'Сначала создайте компонент из исходника.'}</p></div>}
      {error && <p role="alert" className={s.error}>{error}</p>}
    </Modal>;
  } else if (dialog?.kind === 'name') {
    modal = <Modal busy={busy} title={dialog.library === 'sources' ? 'Сохранить исходник' : dialog.library === 'components' ? 'Сохранить компонент' : 'Сохранить композицию'} subtitle={dialog.library === 'components' ? 'В библиотеку сохранится только выделение — самостоятельный SVG.' : 'Файл сохранится в папке проекта.'} onClose={closeDialog}
      footer={<><button className={s.button} disabled={busy} onClick={() => { closeDialog(); dialog.cancel?.(); }}>Отмена</button><button disabled={busy} type="submit" form="name-form" className={`${s.button} ${s.primary}`}>{busy ? <Loader>Сохранение…</Loader> : 'Сохранить'}</button></>}>
      {dialog.warning && <p className={s.compatibilityNote}>Только просмотр. Выделение недоступно: {dialog.warning}</p>}
      {dialog.component && <div className={s.componentPreview}><img src={svgImage(dialog.component.svg)} alt="Превью выделенного компонента" /><p>{dialog.component.bounds.width.toFixed(1)} × {dialog.component.bounds.height.toFixed(1)} · прозрачный фон</p>{dialog.component.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
      <form id="name-form" onSubmit={event => { event.preventDefault(); commitName(); }}><label className={s.fieldLabel} htmlFor="file-name">Имя файла</label><div className={s.nameField}><input autoFocus disabled={busy} id="file-name" value={name} onChange={event => { setName(event.target.value); setError(''); }} aria-invalid={!!error} aria-describedby={error ? 'name-error' : undefined} /><span>{dialog.library === 'compositions' ? '.json' : '.svg'}</span></div>{error && <p role="alert" id="name-error" className={s.error}>{error}</p>}</form>
    </Modal>;
  } else if (dialog?.kind === 'guard') {
    modal = <Modal busy={busy} title="Сохранить изменения?" subtitle={doc.mode === 'source' ? 'На исходнике есть выделение, ещё не сохранённое как компонент.' : 'В текущей композиции есть несохранённые изменения.'} onClose={closeDialog}
      footer={<><button className={s.button} disabled={busy} onClick={closeDialog}>Отмена</button><button className={s.button} disabled={busy} onClick={() => { void runOperation(dialog.proceed); }}>Не сохранять</button><button className={`${s.button} ${s.primary}`} disabled={busy} onClick={() => saveCurrent(dialog.proceed, true)}>Сохранить</button>{saveConflict && <button className={s.button} disabled={busy} onClick={() => saveCurrent(dialog.proceed, false, true)}>Сохранить копию</button>}</>}>{error && <p className={s.error} role="alert">{error}</p>}</Modal>;
  } else if (dialog?.kind === 'confirm') {
    modal = <Modal busy={busy} title={dialog.title} subtitle={dialog.description} onClose={closeDialog}
      footer={<><button className={s.button} disabled={busy} onClick={closeDialog}>{dialog.action === 'Да, перезаписать' ? 'Нет, оставить черновик' : dialog.action === 'Да, создать' ? 'Нет' : 'Отмена'}</button><button className={`${s.button} ${dialog.danger ? s.danger : s.primary}`} disabled={busy} onClick={() => { void runOperation(dialog.accept); }}>{busy ? <Loader>Выполняется…</Loader> : dialog.action}</button>{saveConflict && <button className={s.button} disabled={busy} onClick={() => saveCurrent(undefined, false, true)}>Сохранить копию</button>}</>}><p role="alert" className={s.error}>{error}</p></Modal>;
  } else if (dialog?.kind === 'upload') {
    modal = <Modal busy={busy} title="Загрузить SVG" subtitle="Выберите одну или несколько векторных иллюстраций." onClose={closeDialog}
      footer={<><span className={s.dialogMeta}>{reading ? <Loader>Чтение и проверка…</Loader> : 'Сохранение в проект'}</span><button className={s.button} disabled={busy} onClick={closeDialog}>Отмена</button><button className={`${s.button} ${s.primary}`} disabled={reading || uploadIndex >= uploads.length} onClick={() => saveUpload(uploadIndex)}>Продолжить</button></>}>
      <input ref={fileInput} type="file" accept=".svg" multiple className={s.hiddenInput} aria-label="Выбрать SVG-файлы" onChange={event => chooseFiles(event.target.files)} />
      <button className={s.uploadZone} onClick={() => fileInput.current?.click()}><span className={s.uploadSymbol}><Icon name="upload" size={26} /></span><strong>Выберите SVG-файлы</strong><span>Можно загрузить несколько одновременно</span><span className={s.fileTag}>SVG</span></button>
      {uploads.slice(uploadIndex).map((file, index) => <div className={s.uploadRow} key={file.id}><Icon name="file" /><span>{file.filename}{file.compatibility?.reason && <small className={s.compatibilityNote}>Только просмотр. Выделение недоступно: {file.compatibility.reason}</small>}</span><button className={s.iconButton} aria-label={`Отмена загрузки ${file.filename}`} onClick={() => setUploads(previous => previous.filter((_, i) => i !== index + uploadIndex))}><Icon name="close" size={15} /></button></div>)}
      {error && <p role="alert" className={s.error} style={{ whiteSpace: 'pre-line' }}>{error}</p>}<p className={s.smallNote}>SVG проверяется до сохранения. Исходное содержимое будет записано в папку проекта только после подтверждения имени файла.</p>
    </Modal>;
  } else if (dialog?.kind === 'export') {
    modal = <Modal busy={busy} title="Экспортировать композицию?" subtitle="SVG · 1200 × 800 · прозрачный фон" onClose={closeDialog}
      footer={<><button className={s.button} disabled={busy} onClick={closeDialog}>Отмена</button><button className={`${s.button} ${s.primary}`} disabled={busy} onClick={exportCurrent}><Icon name="download" />{busy ? <Loader>Подготовка SVG…</Loader> : 'Подтвердить экспорт'}</button></>}>
      <div className={s.exportSummary}><Icon name="file" size={32} /><div><strong>{exportFilename(docTitle)}</strong><p>Текущая композиция останется открытой.</p></div></div><p className={s.smallNote}>Скачается текущая композиция с векторными объектами. Экспорт не сохраняет изменения в библиотеку.</p>{error && <p className={s.error} role="alert">{error}</p>}
    </Modal>;
  }

  if (libraries.status !== 'ready') return <div className={s.startup}><Icon name="component" size={34} /><h1>Peeps</h1>{libraries.status === 'loading' ? <Loader>Открываем файлы проекта…</Loader> : <><p role="alert">{libraries.error}</p><button className={s.button} onClick={() => { void libraries.load(); }}>Повторить загрузку</button></>}</div>;
  return <div className={s.app}>
    <header className={s.header}>
      <a href="/" className={s.brand} aria-label="Peeps — главная" onClick={event => { event.preventDefault(); requestTransition(() => openDocument(empty)); }}><span className={s.brandMark}><Icon name="component" size={23} /></span><span>peeps<span className={s.brandDot}>.</span></span></a>
      <div className={s.headerDivider} /><span className={s.appDescription}>Конструктор композиций</span><span className={s.prototypeBadge}>Векторные компоненты</span>
      <span className={s.sessionNote}><span />Файлы проекта</span>
    </header>
    <div className={s.workspace}>
      <LibraryPanel sources={sources} components={components} compositions={compositions} doc={doc} onOpen={openLibraryItem} onDelete={deleteLibraryItem} />
      <main className={s.main}>
        <nav className={s.toolbar} aria-label="Верхняя панель действий">
          {action('upload', 'Загрузить SVG', () => { setUploads([]); setUploadIndex(0); setError(''); setDialog({ kind: 'upload' }); })}
          <span className={s.toolbarDivider} />
          {action('component', 'Создать компонент', () => openPicker('sources'))}
          {action('plus', 'Создать композицию', () => openPicker('components'), false, s.primary)}
          <div className={s.toolbarSpacer} />
          {action('download', 'Экспорт', () => { setError(''); setSaveConflict(false); setDialog({ kind: 'export' }); }, !nonempty)}
        </nav>
        <div className={s.documentBar}><div><span className={s.documentDot} /><span>{docTitle}</span>{dirty && <span className={s.unsaved}>Не сохранено</span>}</div><span>{doc.mode === 'empty' ? 'Начните с исходника' : doc.mode === 'source' ? 'Исходник · выделение объектов' : 'Композиция · 1200 × 800'}</span></div>
        <div className={s.canvasArea} data-testid="canvas" data-mode={doc.mode}>
          {doc.mode === 'empty' ? <div className={s.emptyState}>
            <div className={s.emptyIllustration}><div className={s.backCard} /><div className={s.frontCard}><img src="/demo/peep-standing-24.svg" alt="" /><span className={s.cardCorner} /></div><span className={s.floatingDiamond}><Icon name="component" size={26} /></span><span className={s.floatingPlus}><Icon name="plus" size={17} /></span></div>
            <span className={s.eyebrow}>ВАША СЛЕДУЮЩАЯ ИЛЛЮСТРАЦИЯ</span><h1>Из знакомых деталей.<br />Что-то совершенно новое.</h1><p>Выделяйте элементы SVG-иллюстраций<br />и собирайте из них собственные композиции.</p>
            <button className={`${s.button} ${s.primary} ${s.startButton}`} onClick={() => openPicker('sources')}><Icon name="component" />Выбрать исходник<Icon name="chevron" size={14} /></button>
            <span className={s.emptyHint}>или загрузите свой SVG через верхнюю панель</span>
          </div> : <>
            <div className={s.artboardScroll} data-testid="artboard-scroll">
              <div className={s.artboardWrap} style={{ width: (doc.mode === 'source' ? 500 : 720) * zoom / 100, height: (doc.mode === 'source' ? 570 : 480) * zoom / 100 }}>
                <div className={s.artboardLabel}>{doc.mode === 'source' ? doc.asset.name : 'Холст композиции'}<span>{doc.mode === 'source' ? 'SVG' : '1200 × 800'}</span></div>
                <div data-testid="artboard" className={`${s.artboard} ${doc.mode === 'source' ? s.sourceBoard : s.compositionBoard}`} style={{ transform: `scale(${zoom / 100})` }} onClick={event => { if (!event.shiftKey) { setSelected([]); setRegions([]); } }}>
                  {doc.mode === 'source' ? !sourceCanExtract ? <div className={s.sourcePreview}>{doc.asset.compatibility?.safePreview && <img src={doc.asset.image} alt="Просмотр исходника" />}<p role="status">Только просмотр. Выделение недоступно: {doc.asset.compatibility?.reason}</p></div> : <><Suspense fallback={null}><SourceCanvas key={doc.asset.id} ref={sourceCanvas} svgContent={doc.asset.svgContent} selected={regions} onSelect={setRegions} onStatus={setSourceStatus} /></Suspense>{sourceStatus.state !== 'ready' && <div className={s.sourceMessage} role={sourceStatus.state === 'error' ? 'alert' : 'status'}>{sourceStatus.state === 'error' ? `Не удалось открыть SVG: ${sourceStatus.message}` : <Loader>Подготовка SVG…</Loader>}</div>}</> : doc.items.length ? <CompositionCanvas items={doc.items} selected={selected} onSelect={setSelected} onChange={updateItems} onError={setNotice} /> : <div className={s.emptyComposition}><Icon name="composition" size={35} /><h3>Добавьте первый компонент</h3><button className={`${s.button} ${s.primary}`} onClick={event => { event.stopPropagation(); openPicker('components', true); }}><Icon name="plus" />Добавить элемент</button></div>}
                </div>
              </div>
            </div>
            <aside className={s.properties} aria-label="Правая панель инструментов">
              <div className={s.propertiesTitle}>Инструменты<span>{doc.mode === 'source' ? 'ИСХОДНИК' : 'КОМПОЗИЦИЯ'}</span></div>
              <div className={s.toolGroup}><button className={`${s.tool} ${s.selectedTool}`} aria-pressed="true"><Icon name="cursor" /><span>Выделение</span><kbd>↖</kbd></button>
                <button className={s.tool} disabled={doc.mode === 'source' ? !regions.length : !nonempty || !dirty} onClick={() => saveCurrent()}><Icon name="save" /><span>Сохранить</span></button></div>
              {doc.mode === 'composition' && <button className={`${s.button} ${s.addButton}`} onClick={() => openPicker('components', true)}><Icon name="plus" />Добавить элемент</button>}
              <div className={s.toolGroup}><span className={s.toolCaption}>ОБЪЕКТЫ</span><button className={s.tool} disabled={doc.mode !== 'composition' || !selected.length} onClick={duplicate}><Icon name="copy" /><span>Дублировать</span></button><button className={s.tool} disabled={doc.mode !== 'composition' || !selected.length} onClick={removeSelected}><Icon name="trash" /><span>Удалить</span></button></div>
              <div className={s.toolGroup}><span className={s.toolCaption}>ПОРЯДОК СЛОЁВ</span><button className={s.tool} disabled={doc.mode !== 'composition' || activeIndex < 0 || activeIndex === doc.items.length - 1} onClick={() => moveLayer(1)}><Icon name="forward" /><span>Вперёд</span></button><button className={s.tool} disabled={doc.mode !== 'composition' || activeIndex <= 0} onClick={() => moveLayer(-1)}><Icon name="backward" /><span>Назад</span></button></div>
              {doc.mode === 'composition' && <div className={s.toolGroup}><button className={s.tool} disabled={!outside.length} onClick={restoreOutside}>Вернуть на холст</button>{outside.length > 0 && <p className={s.compatibilityNote}>За холстом: {outside.length}</p>}</div>}
              {doc.mode === 'composition' && activeIndex >= 0 && <TransformFields item={doc.items[activeIndex]} onChange={changed => updateItems(doc.items.map(item => item.instanceId === changed.instanceId ? changed : item))} />}
              <div className={s.selectionInfo}><span className={s.selectionDot} />{selectionCount ? `Выбрано: ${selectionCount}` : 'Нет выделения'}</div>
              {doc.mode === 'source' && extractionError && <p role="alert" className={s.sourceError}>{extractionError}</p>}
            </aside>
          </>}
          <div className={s.canvasHint}><Icon name="cursor" size={14} /><span>{doc.mode === 'empty' ? 'Всё начинается с одной детали' : doc.mode === 'source' ? 'Клик — группа · двойной клик — деталь · Shift + клик — добавить / исключить · Esc — снять' : 'Клик — выбрать · Shift + клик — несколько экземпляров'}</span></div>
          <div className={s.zoom} role="group" aria-label="Масштаб холста"><button aria-label="Уменьшить масштаб" disabled={doc.mode === 'empty' || zoom <= 50} onClick={() => setZoom(value => value - 25)}><Icon name="minus" size={16} /></button><span>{zoom}%</span><button aria-label="Увеличить масштаб" disabled={doc.mode === 'empty' || zoom >= 200} onClick={() => setZoom(value => value + 25)}><Icon name="plus" size={16} /></button></div>
        </div>
        <footer className={s.statusBar}><span><span className={s.statusDot} />{doc.mode === 'empty' ? 'Готово к работе' : dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены'}</span><span>Библиотеки сохраняются в папке проекта · черновик не сохраняется автоматически</span><span>SVG → детали → композиция</span></footer>
      </main>
    </div>
    {busy && !dialog && <div className={s.busyNotice}><Loader>Подготовка компонента…</Loader></div>}{modal}{notice && <div className={s.toast} role="status"><Icon name="info" /><span>{notice}</span><button className={s.iconButton} aria-label="Закрыть уведомление" onClick={() => setNotice('')}><Icon name="close" size={16} /></button></div>}
  </div>;
}
