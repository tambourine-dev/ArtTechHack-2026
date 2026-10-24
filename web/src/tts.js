// Speaks text through the local Kokoro service in tts/, which Vite proxies at /tts.
// The service streams 16-bit mono PCM; each chunk is scheduled right after the previous one,
// so speech starts as soon as the first sentence is ready.

let ctx;
let playhead = 0;

// The first call has to come from a user gesture (a click, or a controller select in XR),
// otherwise the browser keeps the AudioContext suspended.
export async function speak(text, { voice = 'af_heart', speed = 1, lang = 'en-us' } = {}) {
  ctx ??= new AudioContext();
  await ctx.resume();

  const res = await fetch('/tts/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, speed, lang }),
  });
  if (!res.ok) throw new Error(`TTS request failed (${res.status}): ${await res.text()}`);
  const sampleRate = Number(res.headers.get('X-Sample-Rate'));

  // Network chunks can split a 2-byte sample, so an odd trailing byte carries over.
  const reader = res.body.getReader();
  let leftover = new Uint8Array(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const bytes = new Uint8Array(leftover.length + value.length);
    bytes.set(leftover);
    bytes.set(value, leftover.length);
    const even = bytes.length & ~1;
    leftover = bytes.slice(even);
    if (even > 0) schedule(new Int16Array(bytes.buffer, 0, even / 2), sampleRate);
  }
}

function schedule(pcm, sampleRate) {
  const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  playhead = Math.max(playhead, ctx.currentTime + 0.05);
  source.start(playhead);
  playhead += buffer.duration;
}
