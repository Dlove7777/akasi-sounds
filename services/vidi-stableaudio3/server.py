#!/usr/bin/env python3
"""Thin SYNCHRONOUS Stable Audio 3 Medium server for Akasi Sounds.

One blocking endpoint, no job queue (the ACE-Step async worker is exactly what broke):
  POST /generate {prompt, duration, steps?, seed?}  -> audio/wav bytes
  GET  /health                                       -> {status, model, ...}

Run (inside the stable-audio-3 uv env, WSL2/Linux):
  uv run python server.py            # binds 0.0.0.0:8005
Requires HF_TOKEN in env for the gated weights (first run downloads ~model).

The exact StableAudioModel.generate() signature is pinned against the repo at deploy;
this wrapper is defensive about the return shape (tensor -> wav).
"""
import io
import os

import torch
import torchaudio
from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel

MODEL_ID = os.environ.get("SA3_MODEL", "medium")
SAMPLE_RATE = 44100
API_KEY = os.environ.get("STABLE_AUDIO_API_KEY")  # optional bearer

app = FastAPI(title="Akasi Sounds - Stable Audio 3")
_model = None


def get_model():
    global _model
    if _model is None:
        from stable_audio_3 import StableAudioModel  # imported lazily so /health works pre-load
        _model = StableAudioModel.from_pretrained(MODEL_ID)
        if torch.cuda.is_available():
            try:
                _model = _model.to("cuda")
            except Exception:
                pass  # some wrappers manage device internally
    return _model


class GenReq(BaseModel):
    prompt: str
    duration: float = 30.0
    steps: int | None = None
    seed: int | None = None


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "Akasi Stable Audio 3",
        "model": MODEL_ID,
        "loaded": _model is not None,
        "cuda": torch.cuda.is_available(),
        "device": (torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu"),
    }


@app.post("/generate")
def generate(req: GenReq, authorization: str | None = Header(default=None)):
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="bad token")
    try:
        model = get_model()
        kwargs = {"prompt": req.prompt, "duration": float(req.duration)}
        if req.steps:
            kwargs["steps"] = int(req.steps)
        if req.seed is not None:
            kwargs["seed"] = int(req.seed)
        with torch.no_grad():
            audio = model.generate(**kwargs)
    except TypeError:
        # Fall back to the minimal documented signature if extra kwargs aren't accepted.
        with torch.no_grad():
            audio = get_model().generate(prompt=req.prompt, duration=float(req.duration))
    except Exception as e:  # noqa: BLE001
        return JSONResponse(status_code=500, content={"error": str(e)[:400]})

    # Normalize to a CPU float tensor shaped [channels, samples] for torchaudio.
    t = audio
    if not torch.is_tensor(t):
        t = torch.as_tensor(t)
    t = t.detach().to("cpu").float()
    if t.dim() == 3:      # [batch, channels, samples] -> take first
        t = t[0]
    if t.dim() == 1:      # [samples] -> [1, samples]
        t = t.unsqueeze(0)
    peak = t.abs().max()
    if peak > 0:
        t = t / peak * 0.95  # gentle normalize, avoid clipping

    buf = io.BytesIO()
    torchaudio.save(buf, t, SAMPLE_RATE, format="wav")
    return Response(content=buf.getvalue(), media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("SA3_HOST", "0.0.0.0"), port=int(os.environ.get("SA3_PORT", "8005")))
