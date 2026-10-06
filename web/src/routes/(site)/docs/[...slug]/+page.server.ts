import { error } from '@sveltejs/kit';
import { allDocs, docBySlug } from '$lib/server/docs';
import type { EntryGenerator, PageServerLoad } from './$types';

export const entries: EntryGenerator = () => allDocs().map((d) => ({ slug: d.slug }));

export const load: PageServerLoad = ({ params }) => {
  // trailingSlash is 'always', so a rest parameter can arrive with a trailing separator.
  const slug = params.slug.replace(/\/+$/, '');
  const doc = docBySlug(slug);
  if (!doc) throw error(404, `No document at docs/${slug}.md`);
  return { doc };
};
