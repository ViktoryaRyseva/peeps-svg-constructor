/** URI fragments are encoded; DOM IDs are literal Unicode strings. Decode once. */
export function fragmentId(value: string): string {
  try { return decodeURIComponent(value); }
  catch { throw new Error('Некорректное кодирование локальной SVG-ссылки.'); }
}
