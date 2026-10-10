import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertConfig, callModel } from './llm.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOPICS = path.join(here, 'topics.json');
const POSTS = path.join(here, '..', 'src', 'content', 'posts');

const i = process.argv.indexOf('--limit');
const LIMIT = i > -1 ? Number(process.argv[i + 1]) : 1;

try { assertConfig(); } catch (e) { console.error(e.message); process.exit(1); }

const SYSTEM = `You write educational articles for Finance Hub, a site for general readers.
Rules:
- Use ONLY the facts supplied in FACTS plus widely established definitions. Never invent statistics, rates, prices, dates, laws or named studies. If a number would help but is not in FACTS, tell the reader to check the current figure from an official source.
- Educational only: no personalised advice, no recommendations to buy, sell or choose a specific product.
- 700 to 1000 words, plain Markdown, H2 and H3 headings only (no H1), no emoji, no filler introduction.
- Output EXACTLY this format and nothing else:
TITLE: <10-120 characters>
DESCRIPTION: <50-170 characters>
===BODY===
<markdown body>`;

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

function parse(text) {
  const m = text.trim().match(/^TITLE:\s*(.+)\nDESCRIPTION:\s*(.+)\n===BODY===\n([\s\S]+)$/);
  if (!m) throw new Error('Output format not recognised');
  return { title: m[1].trim(), description: m[2].trim(), body: m[3].trim() };
}

function check({ title, description, body }) {
  const errs = [];
  if (title.length < 10 || title.length > 120) errs.push('title length');
  if (description.length < 50 || description.length > 170) errs.push('description length');
  const words = body.split(/\s+/).length;
  if (words < 500) errs.push(`body too short (${words} words)`);
  return errs;
}

const topics = JSON.parse(await fs.readFile(TOPICS, 'utf8'));
const queued = topics.filter((t) => t.status === 'queued').slice(0, LIMIT);
await fs.mkdir(POSTS, { recursive: true });

for (const t of queued) {
  const file = path.join(POSTS, `${t.slug}.md`);
  if (await exists(file)) {
    t.status = 'skipped';
    t.note = 'file already exists';
    continue;
  }
  try {
    const prompt = `TOPIC: ${t.topic}\nCATEGORY: ${t.category}\nFACTS:\n${t.facts.map((f) => `- ${f}`).join('\n')}`;
    const post = parse(await callModel(SYSTEM, prompt));
    const errs = check(post);
    if (errs.length) throw new Error(errs.join(', '));

    const md = [
      '---',
      `title: ${JSON.stringify(post.title)}`,
      `description: ${JSON.stringify(post.description)}`,
      `date: ${new Date().toISOString().slice(0, 10)}`,
      `category: ${JSON.stringify(t.category)}`,
      `sources: ${JSON.stringify(t.sources || [])}`,
      '---',
      '',
      post.body,
      '',
    ].join('\n');

    await fs.writeFile(file, md, 'utf8');
    t.status = 'done';
    console.log(`wrote ${t.slug}`);
  } catch (e) {
    t.status = 'failed';
    t.note = e.message;
    console.error(`failed ${t.slug}: ${e.message}`);
  }
}

await fs.writeFile(TOPICS, JSON.stringify(topics, null, 2) + '\n', 'utf8');
