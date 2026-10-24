"""Local text-to-speech service for the WebXR client, using Kokoro on the CPU (kokoro-onnx).

POST /speak streams raw 16-bit little-endian mono PCM, one chunk per sentence, so playback
can start before the whole text is synthesised. The sample rate is in the X-Sample-Rate header.
"""

import os
import re
from pathlib import Path

import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from kokoro_onnx import SAMPLE_RATE, Kokoro
from pydantic import BaseModel, Field

MODELS = Path(__file__).parent / "models"
kokoro = Kokoro(
    str(MODELS / os.environ.get("KOKORO_MODEL", "kokoro-v1.0.onnx")),
    str(MODELS / "voices-v1.0.bin"),
)
VOICES = set(kokoro.get_voices())
# kokoro-onnx only splits text into batches of ~500 phonemes, so a short paragraph would come
# back as a single chunk. Splitting on sentence ends gets the first sentence out sooner.
SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")
SENTENCE_PAUSE = np.zeros(int(0.25 * SAMPLE_RATE), dtype="<i2").tobytes()

app = FastAPI()


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    voice: str = "af_heart"
    speed: float = Field(1.0, ge=0.5, le=2.0)
    lang: str = "en-us"


@app.get("/voices")
def voices():
    return sorted(VOICES)


@app.post("/speak")
async def speak(req: SpeakRequest):
    if req.voice not in VOICES:
        raise HTTPException(400, f"Unknown voice {req.voice!r}, see GET /voices")

    sentences = [s for s in SENTENCE_END.split(req.text.strip()) if s]

    async def pcm():
        for i, sentence in enumerate(sentences):
            if i > 0:
                yield SENTENCE_PAUSE
            stream = kokoro.create_stream(sentence, voice=req.voice, speed=req.speed, lang=req.lang)
            async for samples, _ in stream:
                yield (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()

    return StreamingResponse(
        pcm(), media_type="application/octet-stream", headers={"X-Sample-Rate": str(SAMPLE_RATE)}
    )


if __name__ == "__main__":
    # Only the Vite dev server needs to reach this, so it stays on localhost.
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("TTS_PORT", "8880")))
