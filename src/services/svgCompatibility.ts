import { parseSvg } from '../svg/base';
import { validateSvgUpload } from './svgUpload';
import type { SvgCompatibility } from '../types/editor';

const cache = new Map<string, SvgCompatibility>();
/** Advisory structural check. Selected geometry/effects are still checked on extraction. */
export function inspectSvg(text: string): SvgCompatibility {
  const cached = cache.get(text); if (cached) return cached;
  let result: SvgCompatibility;
  try {
    validateSvgUpload(text);
    try { parseSvg(text); result = { canExtract: true, safePreview: true }; }
    catch (reason) { result = { canExtract: false, safePreview: true, reason: (reason as Error).message }; }
  } catch (reason) { result = { canExtract: false, safePreview: false, reason: (reason as Error).message }; }
  if (cache.size >= 128) cache.clear(); cache.set(text, result); return result;
}
