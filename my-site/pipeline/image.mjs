import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const POSTS = path.join(ROOT, 'src', 'content', 'posts');
const ASSETS = path.join(ROOT, 'src', 'assets', 'posts');
const TOPICS = path.join(here, 'topics.json');
const USED = path.join(here, 'used-images.json');
const EXTS = ['jpg', 'jpeg', 'png', 'webp'];
const KEY = process.env.PIXABAY_API_KEY;

const AVOID = [
  'people', 'person', 'man', 'woman', 'men', 'women', 'girl', 'boy', 'child', 'children',
  'kid', 'kids', 'baby', 'face', 'portrait', 'couple', 'family', 'selfie',
  'money', 'rupee', 'banknote', 'banknotes', 'currency', 'cash', 'ai', 'generated',
];

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : undefined;
};
const positional = args.filter(
  (a, i) => a.startsWith('--') === false && (i === 0 || args[i - 1].startsWith('--') === false)
);

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function findAsset(slug) {
  for (const ext of EXTS) {
    const name = `${slug}.${ext}`;
    if (await exists(path.join(ASSETS, name))) return name;
  }
  return undefined;
}

async function readUsed() {
  try { return JSON.parse(await fs.readFile(USED, 'utf8')); } catch { return []; }
}

function setCover(md, assetName, credit, alt) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (m === null) throw new Error('frontmatter not found');
  const cleaned = m[1]
    .split('\n')
    .filter((l) => /^(cover|coverAlt|coverCredit):/.test(l) === false)
    .join('\n');
  const add = [
    `cover: "../../assets/posts/${assetName}"`,
    `coverAlt: ${JSON.stringify(alt)}`,
    `coverCredit: ${JSON.stringify({ name: credit.name, page: credit.page, source: credit.source })}`,
  ].join('\n');
  return md.replace(m[0], () => `---\n${cleaned}\n${add}\n---\n`);
}

async function writeCover(slug, assetName, credit, alt) {
  const file = path.join(POSTS, `${slug}.md`);
  if ((await exists(file)) === false) throw new Error(`post not found: src/content/posts/${slug}.md`);
  const md = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, setCover(md, assetName, credit, alt), 'utf8');
}

/* ---------- manual mode (a photo you downloaded yourself) ---------- */
async function applyManual(slug, credit, alt, fileOverride) {
  if (credit.name === undefined || credit.name === '') throw new Error('photographer name is required (--name)');
  if (credit.page === undefined || credit.page.length < 10) throw new Error('photo page link is required (--page)');
  if (alt === undefined || alt.trim() === '') throw new Error('alt text is required (--alt)');
  await fs.mkdir(ASSETS, { recursive: true });
  if (fileOverride !== undefined) {
    const ext = path.extname(fileOverride).slice(1).toLowerCase();
    if (EXTS.includes(ext) === false) throw new Error(`unsupported image type: .${ext}`);
    await fs.copyFile(fileOverride, path.join(ASSETS, `${slug}.${ext}`));
  }
  const asset = await findAsset(slug);
  if (asset === undefined) throw new Error(`no image found: save it as src/assets/posts/${slug}.jpg or pass --file`);
  const source = credit.page.includes('pixabay.com') ? 'Pixabay' : 'Pexels';
  await writeCover(slug, asset, { name: credit.name, page: credit.page, source }, alt);
  console.log(`cover set for ${slug}: ${asset}`);
}

/* ---------- automatic mode (Pixabay API) ---------- */
async function pixabay(query, editors) {
  const p = new URLSearchParams({
    key: KEY,
    q: query.slice(0, 100),
    image_type: 'photo',
    orientation: 'horizontal',
    min_width: '1280',
    safesearch: 'true',
    per_page: '30',
  });
  if (editors) p.set('editors_choice', 'true');
  const res = await fetch(`https://pixabay.com/api/?${p}`);
  if (res.ok === false) throw new Error(`Pixabay request failed (${res.status})`);
  const data = await res.json();
  return data.hits || [];
}

async function candidates(query) {
  const used = new Set(await readUsed());
  let hits = await pixabay(query, true);
  if (hits.length < 3) hits = hits.concat(await pixabay(query, false));
  const seen = new Set();
  return hits
    .filter((h) => {
      if (seen.has(h.id)) return false;
      seen.add(h.id);
      return true;
    })
    .filter((h) => used.has(h.id) === false)
    .filter((h) => {
      const tags = String(h.tags || '').toLowerCase().split(',').map((s) => s.trim());
      return tags.some((t) => AVOID.includes(t) || t.includes('ai generated')) === false;
    });
}

async function applyPixabay(slug, query) {
  const list = await candidates(query);
  if (list.length === 0) throw new Error(`no suitable photo for "${query}"; change imageQuery`);
  const hit = list[0];
  const res = await fetch(hit.largeImageURL);
  if (res.ok === false) throw new Error(`download failed (${res.status})`);
  await fs.mkdir(ASSETS, { recursive: true });
  await fs.writeFile(path.join(ASSETS, `${slug}.jpg`), Buffer.from(await res.arrayBuffer()));
  await writeCover(slug, `${slug}.jpg`, { name: hit.user, page: hit.pageURL, source: 'Pixabay' }, '');
  const used = await readUsed();
  used.push(hit.id);
  await fs.writeFile(USED, JSON.stringify(used, null, 2) + '\n', 'utf8');
  console.log(`cover set for ${slug}: ${hit.pageURL}`);
}

async function main() {
  if (args.includes('--preview')) {
    if (KEY === undefined || KEY === '') { console.error('Set PIXABAY_API_KEY first.'); process.exit(1); }
    const list = await candidates(positional[0] || '');
    list.slice(0, 8).forEach((h, i) => console.log(`${i + 1}. ${h.tags} | ${h.user} | ${h.pageURL}`));
    if (list.length === 0) console.log('no suitable photos');
    return;
  }
  if (args.includes('--auto')) {
    const topics = JSON.parse(await fs.readFile(TOPICS, 'utf8'));
    for (const t of topics) {
      if (t.status === 'done') {
        let md;
        try { md = await fs.readFile(path.join(POSTS, `${t.slug}.md`), 'utf8'); } catch { continue; }
        if (/^cover:/m.test(md)) continue;
        try {
          const have = await findAsset(t.slug);
          if (t.cover && have) await applyManual(t.slug, t.cover, t.cover.alt);
          else if (t.imageQuery && KEY) await applyPixabay(t.slug, t.imageQuery);
          else console.log(`skipping ${t.slug}: no image source`);
        } catch (e) {
          console.error(`image failed for ${t.slug}: ${e.message}`);
        }
      }
    }
    return;
  }
  const slug = positional[0];
  if (slug === undefined) {
    console.error('Usage: npm run image -- --auto | --preview "query" | <slug> --name "..." --page "..." --alt "..." [--file path]');
    process.exit(1);
  }
  await applyManual(slug, { name: opt('--name'), page: opt('--page') }, opt('--alt'), opt('--file'));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
