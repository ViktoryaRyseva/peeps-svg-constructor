import type { CSSProperties } from 'react';

const paths = {
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', close: 'm6 6 12 12M6 18 18 6',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5',
  download: 'M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5',
  component: 'm12 3 9 9-9 9-9-9 9-9Z',
  composition: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  folder: 'M3 6h7l2 2h9v12H3z',
  chevron: 'm9 5 7 7-7 7', check: 'm5 12 4 4L19 6',
  file: 'M14 3H5v18h14V8l-5-5Zm0 0v5h5',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
  copy: 'M8 8h13v13H8zM16 8V3H3v13h5',
  cursor: 'm5 3 14 10-7 1-3 7L5 3Z',
  forward: 'm8 12 4-4 4 4M12 8v12M4 4h16',
  backward: 'm8 12 4 4 4-4M12 16V4M4 20h16',
  save: 'M4 3h13l4 4v14H3V3h1Zm3 0v6h10V3M7 21v-8h10v8',
  info: 'M12 11v6m0-10v.1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  sparkle: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
} as const;
export type IconName = keyof typeof paths;
export default function Icon({ name, size = 18, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>;
}
