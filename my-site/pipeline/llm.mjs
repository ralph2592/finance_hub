const ACCOUNT = process.env.CF_ACCOUNT_ID;
const TOKEN = process.env.CF_API_TOKEN;
const MODEL = process.env.MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export function assertConfig() {
  if (!ACCOUNT) throw new Error('Set CF_ACCOUNT_ID.');
  if (!TOKEN) throw new Error('Set CF_API_TOKEN (Workers AI permission).');
}

export async function callModel(system, prompt, attempt = 1) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/v1/chat/completions`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3000,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
    }
  );
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await new Promise((r) => setTimeout(r, 4000 * attempt));
    return callModel(system, prompt, attempt + 1);
  }
  const raw = await res.text();
  if (!res.ok) throw new Error(`API ${res.status}: ${raw.slice(0, 300)}`);
  let data;
  try { data = JSON.parse(raw); } catch {
    throw new Error(`Non-JSON reply (HTTP ${res.status}): ${raw.slice(0, 200)}`);
  }
  return data.choices?.[0]?.message?.content ?? '';
}
