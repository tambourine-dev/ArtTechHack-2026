// The browser's own text to speech (Web Speech API). Long texts are spoken sentence by
// sentence, because some engines stop on long utterances.

const synth = window.speechSynthesis;

// Browsers only allow speech after a user gesture, so call this from a click handler.
export function unlockSpeech() {
  if (!synth) return;
  const u = new SpeechSynthesisUtterance('');
  u.volume = 0;
  synth.speak(u);
}

// Speaks text; resolves when it has finished (or failed).
export function say(text, lang = 'en-US') {
  if (!synth || !text) return Promise.resolve();
  synth.cancel();
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  return Promise.all(
    sentences.map(
      (s) =>
        new Promise((resolve) => {
          const u = new SpeechSynthesisUtterance(s.trim());
          u.lang = lang;
          u.onend = u.onerror = resolve;
          synth.speak(u);
        }),
    ),
  );
}
