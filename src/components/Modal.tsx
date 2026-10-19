import { useEffect, useRef, type ReactNode } from 'react';
import Icon from './Icon';
import s from '../App.module.css';

export default function Modal({ title, subtitle, onClose, children, footer, wide = false, busy = false }: {
  title: string; subtitle?: string; onClose: () => void; children?: ReactNode; footer?: ReactNode; wide?: boolean; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => { dialog.close(); previouslyFocused?.focus(); };
  }, []);
  return <dialog ref={ref} className={`${s.modal} ${wide ? s.wideModal : ''}`} aria-labelledby="dialog-title"
    aria-busy={busy} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className={s.modalHeader}><div><h2 id="dialog-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      <button className={s.iconButton} disabled={busy} onClick={onClose} aria-label="Закрыть диалог"><Icon name="close" /></button>
    </header>
    {children && <div className={s.modalBody}>{children}</div>}
    {footer && <footer className={s.modalFooter}>{footer}</footer>}
  </dialog>;
}
