// The browser's own text to speech (Web Speech API). Sentences are spoken one at a time
// from a queue kept here rather than the browser's, so the queue can be dropped without
// cutting off the sentence being spoken.

const synth = window.speechSynthesis;
const queue = []; // { text, lang, resolve }
let current = null; // the utterance being spoken; also keeps Chrome from garbage-collecting it

// Browsers only allow speech after a user gesture, so call this from a click handler.
export function unlockSpeech() {
  if (!synth) return;
  const u = new SpeechSynthesisUtterance('');
  u.volume = 0;
  synth.speak(u);
}

// Queues a sentence; resolves when it has been spoken, failed, or was dropped.
export function speak(text, lang = 'en-US') {
  if (!synth || !text) return Promise.resolve();
  return new Promise((resolve) => {
    queue.push({ text, lang, resolve });
    next();
  });
}

function next() {
  if (current || !queue.length) return;
  const { text, lang, resolve } = queue.shift();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  // A timeout backs up onend, in case the engine never reports the end.
  const timer = setTimeout(() => done(), 3000 + text.length * 100);
  const done = () => {
    if (current !== u) return;
    clearTimeout(timer);
    current = null;
    resolve();
    next();
  };
  u.onend = done;
  u.onerror = (e) => {
    if (e?.error !== 'interrupted' && e?.error !== 'canceled') console.warn('[speech] error:', e?.error, text);
    done();
  };
  current = u;
  synth.speak(u);
}

// Drops the queued sentences; the one being spoken finishes.
export function clearSpeech() {
  for (const item of queue.splice(0)) item.resolve();
}

// Drops the queue and cuts off the current sentence too.
export function stopSpeaking() {
  clearSpeech();
  synth?.cancel();
}
