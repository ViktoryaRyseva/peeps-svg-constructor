/** Upload validation is independent from the narrower extraction subset. */
export function validateSvgUpload(text: string): void {
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text)) throw new Error('DTD и внешние XML-стили не поддерживаются.');
  const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (xml.querySelector('parsererror')) throw new Error('Файл содержит некорректный XML.');
  const root = xml.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') throw new Error('В файле должен быть корневой SVG с пространством имён SVG.');
  const checkResources = (value: string) => {
    if (/\\|@import|@font-face|expression\(/i.test(value)) throw new Error('Внешние или динамические CSS-ресурсы не поддерживаются.');
    for (const match of value.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi)) {
      if (!match[1].startsWith('#')) throw new Error('SVG должен быть автономным: внешние ресурсы не поддерживаются.');
    }
  };
  const checkDeclarations = (style: CSSStyleDeclaration) => {
    for (const property of style) if (/^(?:-webkit-)?(?:animation|transition)(?:-|$)/i.test(property)) throw new Error('CSS-анимации и переходы не поддерживаются: нужен статический SVG.');
  };
  const checkRule = (rule: CSSRule) => {
    if (rule.type === CSSRule.KEYFRAMES_RULE) throw new Error('CSS-анимации не поддерживаются: нужен статический SVG.');
    if ('style' in rule) checkDeclarations((rule as CSSStyleRule).style);
    if ('cssRules' in rule) for (const child of (rule as CSSGroupingRule).cssRules) checkRule(child);
  };
  for (const node of [root, ...root.querySelectorAll('*')]) {
    if (node.namespaceURI !== root.namespaceURI || ['script', 'foreignObject', 'image', 'animate', 'animateMotion', 'animateTransform', 'animateColor', 'discard', 'set'].includes(node.localName)) throw new Error(`Элемент <${node.localName}> не поддерживается: нужен статический векторный SVG.`);
    if (node.localName === 'style') {
      checkResources(node.textContent ?? '');
      const sheet = new CSSStyleSheet(); sheet.replaceSync(node.textContent ?? '');
      for (const rule of sheet.cssRules) checkRule(rule);
    }
    for (const attribute of node.attributes) {
      if (/^on/i.test(attribute.localName) || attribute.localName === 'base') throw new Error('События и xml:base в загружаемом SVG не поддерживаются.');
      if (attribute.localName === 'href' && !attribute.value.startsWith('#')) throw new Error('Внешние ссылки SVG не поддерживаются.');
      if (attribute.localName === 'style' || /url\(/i.test(attribute.value)) checkResources(attribute.value);
      if (attribute.localName === 'style') {
        const probe = document.createElementNS(root.namespaceURI, 'g') as SVGGElement;
        probe.setAttribute('style', attribute.value); checkDeclarations(probe.style);
      }
    }
  }
}
export interface PendingUpload { id: string; filename: string; svgContent: string; compatibility?: import('../types/editor').SvgCompatibility }
export async function readSvgFiles(files: File[]): Promise<{ valid: PendingUpload[]; errors: string[] }> {
  const results = await Promise.allSettled(files.map(async file => {
    if (!/\.svg$/i.test(file.name)) throw new Error(`${file.name}: допустимы только файлы .svg.`);
    const svgContent = await file.text();
    try { validateSvgUpload(svgContent); } catch (reason) { throw new Error(`${file.name}: ${(reason as Error).message}`); }
    return { id: crypto.randomUUID(), filename: file.name, svgContent };
  }));
  return {
    valid: results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []),
    errors: results.flatMap(result => result.status === 'rejected' ? [String(result.reason.message)] : []),
  };
}
