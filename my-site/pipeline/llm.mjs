const TOKEN = process.env.MODEL_TOKEN;
const MODEL = process.env.MODEL;

export function assertConfig() {
  if (!TOKEN) throw new Error('Set MODEL_TOKEN (a token with Models: read).');
  if (!MODEL) throw new Error('Set MODEL to a model id.');
}

export async function callModel(system, prompt, attempt = 1) {
  const res = await fetch('https://models.github.ai/inference/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${TOKEN}`,
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await new Promise((r) => setTimeout(r, 4000 * attempt));
    return callModel(system, prompt, attempt + 1);
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}
