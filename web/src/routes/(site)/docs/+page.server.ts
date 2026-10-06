import { docGroups } from '$lib/server/docs';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
  groups: docGroups().map(({ group, pages }) => ({
    group,
    pages: pages.map(({ slug, title }) => ({ slug, title }))
  }))
});
