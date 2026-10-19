import { existsSync, readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

/**
 * Starcom's Zones for a browser test: NavCom's own fixture partition, exactly as
 * `scripts/zsp-vendor.mjs` writes it from the core fixture (`zsp.test.ts` holds the copy here to
 * that), served by route at the stage asked for. No real Zones exist before Stage 1, and nothing
 * synthetic ships, so the build itself has none [map.md, Zones].
 *
 * Returns the names of the files the page asked for, in order.
 */
const FIXTURE = new URL('./fixtures/zsp/', import.meta.url);

export async function serveZones(page: Page, stage: 'final' | '1' | '2' | '3' = 'final'): Promise<string[]> {
  const asked: string[] = [];
  await page.route('**/grid/zsp/*', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop()!;
    asked.push(name);
    const path = new URL(name, FIXTURE);
    if (!existsSync(path)) return route.fulfill({ status: 404, body: 'not found' });
    const topology = JSON.parse(readFileSync(path, 'utf8'));
    topology.navcom.stage = stage;
    topology.navcom.draft = stage !== 'final';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(topology) });
  });
  return asked;
}
