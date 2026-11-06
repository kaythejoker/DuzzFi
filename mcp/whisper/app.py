"""Whisper local (faster-whisper) para o Duzz Finance.

Só é acessado de dentro da VPS (rede do Docker): o servidor Node manda o áudio aqui.
POST /transcribe  (multipart: file, language, prompt) -> {"text": "..."}
"""

import io
import os
import time

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import WhisperModel

MODEL = os.getenv("WHISPER_MODEL", "small")
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE = os.getenv("WHISPER_COMPUTE", "int8")
THREADS = int(os.getenv("WHISPER_THREADS", "0"))  # 0 = automático
MODELS_DIR = os.getenv("WHISPER_MODELS_DIR", "/models")

print(f"Carregando modelo Whisper '{MODEL}' ({DEVICE}/{COMPUTE})...", flush=True)
model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE, cpu_threads=THREADS, download_root=MODELS_DIR)
print("Modelo pronto.", flush=True)

app = FastAPI(title="Duzz Whisper")


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL}


@app.post("/transcribe")
def transcribe(file: UploadFile = File(...), language: str = Form("pt"), prompt: str = Form("")):
    data = file.file.read()  # rota síncrona: o FastAPI roda numa thread e não trava o servidor
    if not data:
        raise HTTPException(400, "áudio vazio")
    started = time.time()
    segments, info = model.transcribe(
        io.BytesIO(data),
        language=language or None,
        initial_prompt=prompt or None,
        beam_size=5,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    text = " ".join(s.text.strip() for s in segments).strip()
    print(f"[whisper] {info.duration:.1f}s de áudio em {time.time() - started:.1f}s: {text!r}", flush=True)
    return {"text": text, "duration": info.duration}
