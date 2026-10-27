import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

/**
 * The Spheres for a browser test: NavCom's own fixture lists, exactly as `scripts/spheres-vendor.mjs`
 * writes them from the core fixture (`spheres.test.ts` holds the copy here to that), served by route.
 * The build ships Mecha Jono's Part 2 lists, which a test cannot hold still, so every test of how the
 * map draws Spheres serves these instead; nothing synthetic ships [map.md, Spheres].
 *
 * Returns the paths the page asked for, in order. `edit` changes the file first, for a test of what the
 * map does with one the vendoring would refuse.
 */
const FIXTURE = new URL('./fixtures/spheres.json', import.meta.url);

export async function serveSpheres(page: Page, edit?: (file: Record<string, any>) => void): Promise<string[]> {
  const asked: string[] = [];
  await page.route('**/grid/spheres.json', async (route) => {
    asked.push(new URL(route.request().url()).pathname);
    // Changed only by a test that asks what the map does with a file no vendoring would write.
    const file = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, any>;
    edit?.(file);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(file) });
  });
  return asked;
}
