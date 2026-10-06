import { takeSnapshot } from '$lib/missions/snapshot';

/**
 * `/missions.json` — the field missions on the map, as of this build. See `$lib/missions/snapshot`
 * for why this is fetched by the build and not by the visitor.
 */
export const prerender = true;

export async function GET() {
  return new Response(JSON.stringify(await takeSnapshot()), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' }
  });
}
