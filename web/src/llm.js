// Asks the local vision LLM (llama-server, proxied at /llm) about an object the user looks
// at. The model gets a crop of the camera picture and a web_search tool, which the page
// runs through the dev server's /search endpoint.

const SYSTEM =
  'You are a quiet guide inside a mixed-reality headset. The image shows an object the ' +
  'wearer is looking at. Identify it as precisely as you can (kind, brand, model, material). ' +
  'Use web_search once or twice to find concrete, interesting information about it. Then ' +
  'answer in two or three short sentences meant to be spoken aloud: no markdown, no lists, ' +
  'no URLs, no questions back.';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web. Returns the top results with title, url and snippet.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The search query' } },
        required: ['query'],
      },
    },
  },
];

const MAX_ROUNDS = 3;

async function chat(messages, tools) {
  const res = await fetch('/llm/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, ...(tools && { tools }), max_tokens: 300, temperature: 0.6 }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  return (await res.json()).choices[0].message;
}

async function webSearch(query) {
  try {
    const res = await fetch(`/search?q=${encodeURIComponent(query)}`);
    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}

// imageUrl: a data: URL of the cropped object. label: what the object detector thinks it is.
export async function describeObject(imageUrl, label) {
  const messages = [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text', text: `The object detector labelled this "${label}". What is it? Tell me about it.` },
      ],
    },
  ];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    // The last round has no tools, so the model has to answer.
    const reply = await chat(messages, round < MAX_ROUNDS - 1 ? TOOLS : undefined);
    if (!reply.tool_calls?.length) return clean(reply.content);
    messages.push(reply);
    for (const call of reply.tool_calls) {
      let query = '';
      try {
        query = JSON.parse(call.function.arguments).query ?? '';
      } catch {}
      console.log('[llm] web_search:', query);
      messages.push({ role: 'tool', tool_call_id: call.id, content: await webSearch(query) });
    }
  }
  return '';
}

const clean = (text = '') =>
  text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/[*_#`]/g, '')
    .trim();
