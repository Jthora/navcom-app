import { buildExport } from '@navcom/core';
import { loadAll } from '$lib/directory/load';

export const prerender = true;

/**
 * The canonical machine-readable directory. See src/lib/directory/export.ts for why the
 * verdicts ship alongside the data rather than the consumer recomputing them.
 */
export function GET() {
  const { records, regions } = loadAll();
  /*
   * Not pretty-printed. The indentation was 12 MB of spaces and newlines in a 28 MB file —
   * carried in every retained deployment, on an account close to its storage cap. A consumer
   * of a machine-readable export pipes it through a formatter if a person needs to read it.
   */
  const body = JSON.stringify(buildExport(records, new Date(), regions));
  return new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // A consumer that caches this longer than the margin is serving stale verdicts.
      'cache-control': 'public, max-age=3600'
    }
  });
}
