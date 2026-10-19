import type { Page } from '@playwright/test';
import legacy from './legacyMarkup';
import current from './currentMarkup';

/** Test-only DOM and driver. No HTML route or production entry point is created. */
export async function openSvgFixture(page: Page, version: 'legacy' | 'current') {
  await page.goto('/');
  await page.setContent(version === 'legacy' ? legacy : current);
  await page.evaluate(async version => {
    await import(`/src/tests/fixtures/${version}Driver.ts`);
  }, version);
}
