import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertConfig, callModel } from './llm.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOPICS = path.join(here, 'topics.json');
const POSTS = path.join(here, '..', 'src', 'content', 'posts');
const REJECTED = path.join(here, 'rejected');
const MIN_WORDS = Number(process.env.MIN_WORDS || 450);
const MAX_REPEAT = Number(process.env.MAX_REPEAT || 0.03);
const PUBLISH = process.env.PUBLISH === 'true';
const MAX_TRIES = 3;

const i = process.argv.indexOf('--limit');
const LIMIT = i > -1 ? Number(process.argv[i + 1]) : 1;

try { assertConfig(); } catch (e) { console.error(e.message); process.exit(1); }

const SYSTEM = `You write educational articles for Finance Hub, a site for general readers in India.
Rules:
- Use ONLY the facts supplied in FACTS plus widely established definitions. Every H2 section must use at least one concrete point from FACTS. Do not repeat the same idea in more than one section.
- Never write a number that is not in FACTS, in digits or in words (for example "five years", "a few hundred rupees", "10%"). Where an amount would help, say to check the current figure in the scheme or policy document.
- Describe how things work and what to compare. Do not tell the reader what they should buy, invest in or do.
- Put each fact in the section where it belongs. Never join unrelated facts in one sentence.
- Never use these phrases: "in conclusion", "it is important to note", "it is essential", "numerous", "you should", "afford to lose", "delve".
- Use EXACTLY the H2 headings given in OUTLINE, in that order, written as "## Heading". No H1, no Conclusion or Summary section, no introduction filler, no emoji.
- Body between 500 and 750 words. Do not pad. State each fact once and do not re-define the topic in later sections.
- Output EXACTLY this format and nothing else (no code fences):
TITLE: <20-100 characters>
===BODY===
<markdown body>`;

const NUMWORDS = /\b(two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred|thousand|lakh|crore|million|billion|percent)\b/g;
const BANNED = ['in conclusion', 'it is important to note', 'it is essential', 'numerous', 'you should', 'afford to lose', 'delve', 'informed decisions', 'disciplined', 'by understanding'];

const numbersIn = (text) =>
  (text.replace(/^\s*\d+[.)]\s/gm, '').match(/\d[\d,]*(?:\.\d+)?%?/g) || []).map((s) => s.replace(/,+$/, ''));

function repetition(body) {
  const w = body.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const seen = new Set();
  let dup = 0;
  for (let k = 0; k <= w.length - 6; k++) {
    const g = w.slice(k, k + 6).join(' ');
    if (seen.has(g)) dup++; else seen.add(g);
  }
  return dup / Math.max(1, w.length);
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

function makeDescription(body) {
  const first = body
    .replace(/^#{1,6} .*$/gm, '')
    .replace(/[*_`>]/g, '')
    .trim()
    .split(/\n\s*\n/)[0]
    .replace(/\s+/g, ' ');
  const sentences = first.match(/[^.!?]+[.!?]+/g) || [first];
  let d = '';
  for (const s of sentences) {
    if ((d + ' ' + s).trim().length > 160) break;
    d = (d + ' ' + s).trim();
  }
  if (d.length < 50) d = first.slice(0, 157).replace(/\s+\S*$/, '') + '...';
  return d;
}

function parse(text, t) {
  const clean = text.replace(/```(?:markdown|md)?/g, '').trim();
  const tm = clean.match(/^\W*TITLE:\s*\**\s*(.+)$/im);
  const bi = clean.indexOf('===BODY===');
  let body;
  if (bi !== -1) {
    body = clean.slice(bi + '===BODY==='.length).trim();
  } else {
    const h = clean.search(/^##\s/m);
    if (h === -1) throw new Error('output format not recognised');
    body = clean.slice(h).trim();
  }
  const title = (t && t.title) || (tm ? tm[1].replace(/\*+/g, '').trim() : '');
  if (title === '') throw new Error('output format not recognised');
  return { title, description: makeDescription(body), body };
}

function check({ title, description, body }, t) {
  const errs = [];
  if (title.length < 10 || title.length > 120) errs.push(`title is ${title.length} characters, must be 10-120`);
  if (description.length < 50 || description.length > 170) errs.push(`description is ${description.length} characters, must be 50-170`);
  const words = body.split(/\s+/).length;
  if (words < MIN_WORDS) errs.push(`body is ${words} words, must be at least ${MIN_WORDS}`);

  const allowed = [t.topic, ...t.facts, ...(t.outline || [])].join(' ');
  const okNums = new Set(numbersIn(allowed));
  const badNums = [...new Set(numbersIn(body))].filter((n) => !okNums.has(n));
  if (badNums.length) errs.push(`numbers not in FACTS: ${badNums.join(', ')}`);

  const okWords = new Set(allowed.toLowerCase().match(NUMWORDS) || []);
  const badWords = [...new Set(body.toLowerCase().match(NUMWORDS) || [])].filter((w) => !okWords.has(w));
  if (badWords.length) errs.push(`number words not in FACTS: ${badWords.join(', ')}`);

  const low = body.toLowerCase();
  const hits = BANNED.filter((p) => low.includes(p));
  if (hits.length) errs.push(`banned phrases: ${hits.join(', ')}`);
  if (/^##\s*(conclusion|summary)/im.test(body)) errs.push('has a Conclusion or Summary section');

  const rep = repetition(body);
  if (rep > MAX_REPEAT) errs.push(`repetitive text (${(rep * 100).toFixed(1)}% repeated phrases)`);

  for (const h of t.outline || []) {
    if (!low.includes(`## ${h.toLowerCase()}`)) errs.push(`missing heading "## ${h}"`);
  }
  return errs;
}

function stripFiller(body) {
  return body
    .split('\n')
    .map((line) => {
      if (/^#{1,6}\s/.test(line) || line.trim() === '') return line;
      const kept = line
        .split(/(?<=[.!?])\s+/)
        .filter((s) => BANNED.some((p) => s.toLowerCase().includes(p)) === false);
      return kept.join(' ');
    })
    .join('\n');
}

async function attempt(t, feedback = '') {
  const base = `TOPIC: ${t.topic}\nCATEGORY: ${t.category}\nOUTLINE:\n${(t.outline || []).map((h) => `- ${h}`).join('\n')}\nFACTS:\n${t.facts.map((f) => `- ${f}`).join('\n')}`;
  const prompt = feedback
    ? `${base}\n\nYour previous draft was rejected: ${feedback}. Write a complete new draft that fixes every problem and follows the format exactly.`
    : base;
  const raw = await callModel(SYSTEM, prompt);
  try {
    const post = parse(raw, t);
    post.body = stripFiller(post.body);
    post.description = makeDescription(post.body);
    return { raw, post, errs: check(post, t) };
  } catch (e) {
    return { raw, errs: [e.message] };
  }
}

const topics = JSON.parse(await fs.readFile(TOPICS, 'utf8'));
const queued = topics.filter((t) => t.status === 'queued').slice(0, LIMIT);
await fs.mkdir(POSTS, { recursive: true });
await fs.mkdir(REJECTED, { recursive: true });

for (const t of queued) {
  const file = path.join(POSTS, `${t.slug}.md`);
  if (await exists(file)) {
    t.status = 'skipped';
    t.note = 'file already exists';
    continue;
  }
  try {
    let feedback = '';
    let result;
    for (let n = 1; n <= MAX_TRIES; n++) {
      result = await attempt(t, feedback);
      if (!result.errs.length) break;
      feedback = result.errs.join('; ');
      console.log(`${t.slug}: attempt ${n} rejected (${feedback})`);
      await fs.writeFile(path.join(REJECTED, `${t.slug}-try${n}.txt`), result.raw, 'utf8');
    }
    if (result.errs.length) throw new Error(`rejected after ${MAX_TRIES} tries: ${feedback}`);

    const { post } = result;
    if (t.title) post.title = t.title;
    const md = [
      '---',
      `title: ${JSON.stringify(post.title)}`,
      `description: ${JSON.stringify(post.description)}`,
      `date: ${new Date().toISOString().slice(0, 10)}`,
      `category: ${JSON.stringify(t.category)}`,
      `sources: ${JSON.stringify(t.sources || [])}`,
      `draft: ${PUBLISH ? 'false' : 'true'}`,
      '---',
      '',
      post.body,
      '',
    ].join('\n');

    await fs.writeFile(file, md, 'utf8');
    t.status = 'done';
    delete t.note;
    console.log(`wrote ${t.slug} (${post.body.split(/\s+/).length} words, draft=${!PUBLISH})`);
  } catch (e) {
    t.status = 'failed';
    t.note = e.message;
    console.error(`failed ${t.slug}: ${e.message}`);
  }
}

await fs.writeFile(TOPICS, JSON.stringify(topics, null, 2) + '\n', 'utf8');
