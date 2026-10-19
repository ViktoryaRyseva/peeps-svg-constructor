import paper from 'paper/dist/paper-core';
import { SVGPathData, type SVGCommand } from 'svg-pathdata';
import { SvgExtractionError } from './base';

const scope = new paper.PaperScope();
scope.setup(new scope.Size(1, 1));
scope.view.autoUpdate = false;

export interface PathPart { indices: number[]; d: string; holes: number }
export interface PathAnalysis { subpaths: string[]; parts: PathPart[]; fallback?: string }

/** Full SVG command parser, not string splitting. Arcs stay arcs in the exported d. */
export function absoluteSubpaths(d: string): string[] {
  const commands = new SVGPathData(d).toAbs().normalizeST().commands;
  const groups: SVGCommand[][] = [];
  for (const command of commands) {
    if (command.type === SVGPathData.MOVE_TO) groups.push([]);
    if (!groups.length) throw new Error('Контур должен начинаться с команды moveto.');
    groups[groups.length - 1].push(command);
  }
  return groups.map(group => SVGPathData.encode(group));
}

/** Split into safely separable contour clusters, keeping holes with their paint.
 * Ambiguous intersections stay together; open paths stay whole. No boolean geometry is invented.
 */
export function analyzePath(d: string, fillRule: string): PathAnalysis {
  let subpaths: string[];
  try { subpaths = absoluteSubpaths(d); }
  catch { throw new SvgExtractionError('INVALID_PATH', 'Некорректный SVG-контур: проверьте завершённость и параметры команд path.'); }
  const fallback = (reason: string): PathAnalysis => ({ subpaths, parts: [{ indices: subpaths.map((_, index) => index), d, holes: 0 }], fallback: reason });
  if (subpaths.length < 2) return fallback('Один непрерывный контур; дальнейшего структурного разделения нет.');
  if (subpaths.length > 128) return fallback('Превышен лимит анализа 128 подконтуров; доступен исходный объект целиком.');
  const paths: paper.Path[] = [];
  try {
    for (const data of subpaths) paths.push(new scope.Path({ pathData: data, insert: false }));
    if (paths.reduce((sum, path) => sum + path.segments.length, 0) > 5000) return fallback('Слишком сложный контур для интерактивного анализа; доступен целиком.');
    if (paths.some(path => !path.closed || Math.abs(path.area) < 1e-8)) return fallback('Есть открытый или вырожденный подконтур; автоматическое разбиение отключено.');
    const sets = paths.map((_, index) => index);
    const find = (index: number): number => sets[index] === index ? index : (sets[index] = find(sets[index]));
    const unite = (a: number, b: number) => { sets[find(b)] = find(a); };
    const selfCrossing = paths.map(path => path.getIntersections(path).length > 0);
    for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
      // A self-intersecting contour stays untouched. Any contour whose bounds
      // touch it is conservatively tied to it, while disjoint details survive.
      if (paths[i].bounds.intersects(paths[j].bounds) && (selfCrossing[i] || selfCrossing[j] || paths[i].getIntersections(paths[j]).length)) unite(i, j);
    }
    const parents = paths.map((path, index) => {
      let parent = -1, area = Infinity;
      for (let other = 0; other < paths.length; other++) if (other !== index && Math.abs(paths[other].area) > Math.abs(path.area) && paths[other].bounds.contains(path.bounds) && paths[other].contains(path.interiorPoint)) {
        if (Math.abs(paths[other].area) < area) { parent = other; area = Math.abs(paths[other].area); }
      }
      return parent;
    });
    const depth = (index: number): number => parents[index] < 0 ? 0 : 1 + depth(parents[index]);
    const outsideWinding = (index: number): number => parents[index] < 0 ? 0 : outsideWinding(parents[index]) + Math.sign(paths[parents[index]].area);
    for (let index = 0; index < paths.length; index++) {
      const parent = parents[index];
      if (parent < 0) continue;
      if (fillRule === 'evenodd') { if (depth(index) % 2 === 1) unite(index, parent); }
      else {
        const before = outsideWinding(index);
        // Retain holes and redundant winding contours with their enclosing paint.
        if (before !== 0) unite(index, parent);
      }
    }
    const clusters = new Map<number, number[]>();
    paths.forEach((_, index) => { const key = find(index); clusters.set(key, [...(clusters.get(key) ?? []), index]); });
    const parts = [...clusters.values()].map(indices => ({
      indices, d: indices.map(value => subpaths[value]).join(' '),
      holes: indices.filter(index => !selfCrossing[index] && (fillRule === 'evenodd' ? depth(index) % 2 === 1 : outsideWinding(index) !== 0 && outsideWinding(index) + Math.sign(paths[index].area) === 0)).length,
    })).sort((a, b) => a.indices[0] - b.indices[0]);
    return { subpaths, parts, ...(parts.length === 1 ? { fallback: 'Подконтуры связаны пересечениями, вложенным заполнением или отверстиями; доступны вместе.' } : {}) };
  } catch (reason) {
    return fallback(`Не удалось надёжно разобрать геометрию: ${(reason as Error).message}`);
  } finally { paths.forEach(path => path.remove()); }
}
