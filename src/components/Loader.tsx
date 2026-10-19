import s from '../App.module.css';
export default function Loader({ children = 'Загрузка…' }: { children?: React.ReactNode }) {
  return <span className={s.loader} role="status"><span className={s.spinner} aria-hidden="true" />{children}</span>;
}
