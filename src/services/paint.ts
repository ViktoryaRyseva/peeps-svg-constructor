/** Let React commit the pending state and the browser paint before synchronous SVG work. */
export const yieldForPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
