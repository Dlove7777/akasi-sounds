#!/usr/bin/env python3
"""Akasi Sounds CLAP service — local semantic audio AI (laion/clap-htsat-unfused).

Long-running JSONL protocol on stdio (model loads once, ~5s):
  {"op":"ping"}                          → {"ok":true,"model":...}
  {"op":"embed_text","text":"..."}       → {"embedding":[512 floats]}
  {"op":"embed_audio","path":"..."}      → {"embedding":[512 floats]}
  {"op":"classify","path":"..."}         → {"kind","genre","vocals","confidence":{...}}
Everything runs on-device; the model caches in ~/.cache/huggingface after the
first download and works offline from then on.
"""
import json
import sys
import warnings

warnings.filterwarnings("ignore")

import numpy as np  # noqa: E402
import librosa  # noqa: E402
import torch  # noqa: E402
from transformers import ClapModel, ClapProcessor  # noqa: E402

MODEL_ID = "laion/clap-htsat-unfused"
SR = 48000  # CLAP's expected sample rate

KIND_BANK = {
    "sfx": "a sound effect",
    "music": "a piece of music",
    "sfx_speech": "a person speaking",
}
VOCAL_BANK = {
    "instrumental": "instrumental music without any singing",
    "vocals": "music with singing vocals",
}
GENRE_BANK = {
    "Cinematic": "epic cinematic orchestral film score",
    "Ambient": "calm ambient atmospheric music",
    "Lo-Fi": "lofi hip hop chill beat",
    "Hip Hop": "hip hop rap beat",
    "Electronic": "electronic dance music with synthesizers",
    "Rock": "rock music with electric guitars and drums",
    "Jazz": "jazz music",
    "Classical": "classical music",
    "Folk": "acoustic folk music",
    "Pop": "pop music",
    "Tension": "dark suspenseful tension underscore",
    "Funk": "funk and soul groove",
    "Metal": "heavy metal music",
    "Piano": "solo piano music",
    "World": "world music with traditional instruments",
}


class Clap:
    def __init__(self) -> None:
        self.model = ClapModel.from_pretrained(MODEL_ID)
        self.model.eval()
        self.processor = ClapProcessor.from_pretrained(MODEL_ID)
        self._text_cache: dict[str, np.ndarray] = {}

    @staticmethod
    def _vec(out) -> np.ndarray:
        # transformers 5 returns BaseModelOutputWithPooling; 4.x returned a tensor.
        t = out.pooler_output if hasattr(out, "pooler_output") else out
        e = t.squeeze().numpy().astype(np.float32)
        return e / (np.linalg.norm(e) + 1e-9)

    def text(self, s: str) -> np.ndarray:
        if s not in self._text_cache:
            inputs = self.processor(text=[s], return_tensors="pt", padding=True)
            with torch.no_grad():
                self._text_cache[s] = self._vec(self.model.get_text_features(**inputs))
        return self._text_cache[s]

    def audio(self, path: str) -> np.ndarray:
        y, _ = librosa.load(path, sr=SR, mono=True, duration=30)
        inputs = self.processor(audio=[y], sampling_rate=SR, return_tensors="pt")
        with torch.no_grad():
            return self._vec(self.model.get_audio_features(**inputs))

    def pick(self, audio_emb: np.ndarray, bank: dict) -> tuple[str, float]:
        keys = list(bank)
        sims = np.array([float(audio_emb @ self.text(bank[k])) for k in keys])
        probs = np.exp(sims * 20) / np.exp(sims * 20).sum()  # sharpened softmax
        i = int(probs.argmax())
        return keys[i], float(probs[i])

    def classify(self, path: str) -> dict:
        emb = self.audio(path)
        kind, kc = self.pick(emb, KIND_BANK)
        out = {
            "kind": "music" if kind == "music" else "sfx",
            "confidence": {"kind": round(kc, 3)},
            "embedding": emb.tolist(),
        }
        if out["kind"] == "music":
            vocals, vc = self.pick(emb, VOCAL_BANK)
            genre, gc = self.pick(emb, GENRE_BANK)
            out.update(vocals=1 if vocals == "vocals" else 0, genre=genre)
            out["confidence"].update(vocals=round(vc, 3), genre=round(gc, 3))
        return out


def main() -> None:
    clap = Clap()
    print(json.dumps({"ready": True, "model": MODEL_ID}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            op = req.get("op")
            if op == "ping":
                out = {"ok": True, "model": MODEL_ID}
            elif op == "embed_text":
                out = {"embedding": clap.text(req["text"]).tolist()}
            elif op == "embed_audio":
                out = {"embedding": clap.audio(req["path"]).tolist()}
            elif op == "classify":
                out = clap.classify(req["path"])
            else:
                out = {"error": f"unknown op {op!r}"}
        except Exception as e:  # noqa: BLE001 — always answer, keep the service alive
            out = {"error": str(e)[:300]}
        out["id"] = req.get("id") if isinstance(req, dict) else None
        print(json.dumps(out), flush=True)


if __name__ == "__main__":
    main()
