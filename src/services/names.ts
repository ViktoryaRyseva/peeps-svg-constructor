import type { LibraryKind } from '../types/project.ts';

export const nameKey = (name: string) => name.trim().normalize('NFC').toLocaleLowerCase('ru');
export function normalizeName(input: string, library: LibraryKind) {
  const extension = library === 'compositions' ? '.json' : '.svg';
  const base = input.trim().replace(new RegExp(`${extension.replace('.', '\\.')}$`, 'i'), '').trim().normalize('NFC');
  if (!base || /[\\/\u0000-\u001f]/.test(base)) throw new Error('Введите имя без символов /, \\ и управляющих символов.');
  return `${base}${extension}`;
}
export function storageError(reason: unknown): string {
  const error = reason as { name?: string; message?: string };
  if (error.name === 'ConstraintError') return 'Такое имя уже есть в этой библиотеке. Выберите другое.';
  if (error.name === 'QuotaExceededError') return 'Недостаточно места в локальном хранилище. Файл не сохранён; освободите место и повторите.';
  if (error.name === 'SecurityError') return 'Браузер запретил доступ к локальному хранилищу. Разрешите IndexedDB и повторите загрузку.';
  if (error.name === 'DatabaseClosedError' || error.name === 'InvalidStateError') return 'Локальное хранилище недоступно. Данные не изменены; попробуйте ещё раз.';
  return error.message || 'Не удалось выполнить операцию с локальным хранилищем. Данные не изменены.';
}
