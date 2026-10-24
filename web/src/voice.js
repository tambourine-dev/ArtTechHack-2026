// Positioned speakers for the narrations: Kokoro speech (the tts/ service, proxied at
// /tts) played through Web Audio, each Voice with its own gain (volume) and stereo panner,
// so several can talk at once from different directions.

let ctx = null;

// Browsers keep audio suspended until a user gesture, so call this from a click handler.
export function unlockAudio() {
  ctx ??= new AudioContext();
  ctx.resume();
}

// Kokoro voices handed out in turn, so simultaneous narrations sound different.
const NAMES = ['af_heart', 'am_michael', 'bf_emma', 'am_fenrir', 'af_bella'];
const inUse = new Set();

export class Voice {
  #sentences = []; // { text, abort, sources, start, end, resolve }, queued or playing
  #chain = Promise.resolve();
  #playhead = 0;

  constructor() {
    unlockAudio();
    this.name = NAMES.find((n) => !inUse.has(n)) ?? NAMES[0];
    inUse.add(this.name);
    this.gain = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.gain.connect(this.panner).connect(ctx.destination);
  }

  // pan -1 (left) .. 1 (right), volume 0..1; eased so moving boxes don't click.
  place(pan, volume) {
    this.panner.pan.setTargetAtTime(pan, ctx.currentTime, 0.15);
    this.gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.15);
  }

  // Queues a sentence; resolves when it has been played, failed, or was dropped. Sentences
  // are synthesised one after another but played back to back, so the next one is usually
  // ready when the previous one ends.
  say(text) {
    const item = { text, abort: new AbortController(), sources: [], start: Infinity, end: 0 };
    const done = new Promise((resolve) => (item.resolve = resolve));
    this.#sentences.push(item);
    this.#chain = this.#chain.then(() => this.#synthesise(item));
    return done;
  }

  async #synthesise(item) {
    if (item.abort.signal.aborted) return;
    try {
      const res = await fetch('/tts/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: item.text, voice: this.name }),
        signal: item.abort.signal,
      });
      if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
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
        if (even > 0) this.#schedule(item, new Int16Array(bytes.buffer, 0, even / 2), sampleRate);
      }
    } catch (err) {
      if (!item.abort.signal.aborted) console.warn('[tts]', err.message);
    }
    setTimeout(() => this.#drop(item), Math.max(0, item.end - ctx.currentTime) * 1000);
  }

  #schedule(item, pcm, sampleRate) {
    if (item.abort.signal.aborted) return;
    const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    this.#playhead = Math.max(this.#playhead, ctx.currentTime + 0.05);
    source.start(this.#playhead);
    item.start = Math.min(item.start, this.#playhead);
    this.#playhead += buffer.duration;
    item.end = this.#playhead;
    item.sources.push(source);
  }

  #drop(item, cut = false) {
    item.abort.abort();
    if (cut) for (const s of item.sources) s.stop();
    this.#sentences = this.#sentences.filter((i) => i !== item);
    item.resolve();
  }

  // Drops the sentences that haven't started playing; the one playing finishes.
  clear() {
    const now = ctx.currentTime;
    for (const item of this.#sentences) if (item.start > now) this.#drop(item, true);
    this.#playhead = Math.max(now, ...this.#sentences.map((i) => i.end));
  }

  // Cuts everything off, the sentence playing included.
  stop() {
    for (const item of this.#sentences) this.#drop(item, true);
    this.#playhead = 0;
  }

  // Lets another narration use this voice name.
  release() {
    inUse.delete(this.name);
  }
}
