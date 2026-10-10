import { getCollection } from 'astro:content';

export async function getPosts() {
  const all = await getCollection(
    'posts',
    ({ data }) => import.meta.env.DEV || data.draft === false
  );
  return all.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export function fmtDate(d: Date) {
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function readingMinutes(body: string | undefined) {
  const words = (body ?? '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
