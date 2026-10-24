// Talks with the local vision LLM (llama-server, proxied at /llm) about what the user looks
// at. narrate() keeps going for as long as it isn't aborted: the first turn says what the
// image shows, straight from the picture (fast), and every later turn adds one new thing,
// with a web_search tool the page runs through the dev server's /search endpoint.
// Replies are streamed, so each sentence can be spoken as soon as it's complete.

const SYSTEM =
  'You are a quiet guide inside a mixed-reality headset, talking to the wearer about what ' +
  'they are looking at. Your words are spoken aloud: short plain sentences, no markdown, no ' +
  'lists, no line breaks, no URLs, no questions back. Answer in at most two complete, ' +
  'punctuated sentences, then stop. Each turn adds something new; never repeat what you ' +
  'already said.';

const firstPrompt = (label) =>
  label
    ? `The wearer is looking at this. The object detector thinks it is "${label}". ` +
      'Say what it is, as precisely as you can (kind, brand, model, material).'
    : 'The wearer is looking around this scene. Say in a sentence what is in front of them.';

const MORE =
  'They are still looking at it. Tell them one more interesting thing about it: history, how ' +
  'it is made, what it costs, a curiosity, something you have not mentioned yet. Use ' +
  'web_search when you need facts. At most two sentences.';

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

const KEEP_TURNS = 4; // earlier turns are dropped, to stay inside the 8192-token context
const MAX_TOKENS = 70; // per turn; short turns react sooner when the gaze moves on

async function webSearch(query, signal) {
  try {
    const res = await fetch(`/search?q=${encodeURIComponent(query)}`, { signal });
    return await res.text();
  } catch (err) {
    if (signal.aborted) throw err;
    return JSON.stringify({ error: err.message });
  }
}

const clean = (text) => text.replace(/<\/?think>/g, '').replace(/[*_#`]/g, '');

// One streamed reply. Yields { sentence } as sentences complete, returns the whole message.
async function* streamReply(messages, tools, signal) {
  const res = await fetch('/llm/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, ...(tools && { tools }), stream: true, max_tokens: MAX_TOKENS, temperature: 0.7 }),
    signal,
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let content = '';
  let pending = ''; // text not yet given out as a sentence
  let lines = '';
  const toolCalls = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    lines += value;
    let nl;
    while ((nl = lines.indexOf('\n')) >= 0) {
      const line = lines.slice(0, nl).trim();
      lines = lines.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      const delta = JSON.parse(data).choices?.[0]?.delta ?? {};
      for (const tc of delta.tool_calls ?? []) {
        const call = (toolCalls[tc.index ?? 0] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
        if (tc.id) call.id = tc.id;
        if (tc.function?.name) call.function.name += tc.function.name;
        if (tc.function?.arguments) call.function.arguments += tc.function.arguments;
      }
      if (!delta.content) continue;
      content += delta.content;
      pending += clean(delta.content);
      // A sentence ends at . ! or ? followed by a space (so "3.5" isn't split), or at a line
      // break, which the model sometimes uses instead of punctuation.
      let m;
      while ((m = pending.match(/^([\s\S]*?)(?:([.!?])\s+|\n+)/))) {
        const sentence = (m[1] + (m[2] ?? '')).trim();
        if (sentence) yield { sentence };
        pending = pending.slice(m[0].length);
      }
    }
  }
  if (pending.trim()) yield { sentence: pending.trim() };
  return { role: 'assistant', content, ...(toolCalls.length && { tool_calls: toolCalls }) };
}

// imageUrl: a data: URL of the cropped object (or the whole scene). label: what the object
// detector thinks it is, or null for the scene. Yields { sentence } for every sentence and
// { end: true } after each turn; runs until signal is aborted.
export async function* narrate(imageUrl, label, signal) {
  const base = [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text', text: firstPrompt(label) },
      ],
    },
  ];
  const history = []; // alternating assistant / user turns, without the tool traffic
  let empty = 0;
  for (let turn = 0; !signal.aborted; turn++) {
    if (turn > 0) history.push({ role: 'user', content: MORE });
    const convo = [...base, ...history.slice(-(KEEP_TURNS * 2 - 1))];
    let text = '';
    // At most one search per turn; the first turn answers from the picture alone.
    for (let hop = 0; hop < 2; hop++) {
      const reply = yield* streamReply(convo, turn > 0 && hop === 0 ? TOOLS : undefined, signal);
      text += reply.content;
      if (!reply.tool_calls) break;
      convo.push(reply);
      for (const call of reply.tool_calls) {
        let query = '';
        try {
          query = JSON.parse(call.function.arguments).query ?? '';
        } catch {}
        console.log('[llm] web_search:', query);
        convo.push({ role: 'tool', tool_call_id: call.id, content: await webSearch(query, signal) });
      }
    }
    text = clean(text).trim();
    if (!text && ++empty >= 2) return; // nothing more to say
    history.push({ role: 'assistant', content: text });
    yield { end: true };
  }
}
