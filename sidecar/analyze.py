#!/usr/bin/env python3
"""Akasi Sounds analysis sidecar — BPM + musical key detection (librosa).

Usage: analyze.py <file> [<file> ...]   (or newline-separated paths on stdin)
Emits one JSON object per line: {"path", "bpm", "key", "duration"} or {"path", "error"}.
Runs in its own venv (see setup.sh) — the app's Node/Electron never imports Python.
"""
import json
import sys
import warnings

warnings.filterwarnings("ignore")

import numpy as np  # noqa: E402
import librosa  # noqa: E402

# Krumhansl-Schmuckler key profiles (major / minor)
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def detect_key(chroma_mean: np.ndarray) -> str:
    best, best_key = -2.0, ""
    for shift in range(12):
        rolled = np.roll(chroma_mean, -shift)
        for profile, suffix in ((MAJOR, ""), (MINOR, "m")):
            r = float(np.corrcoef(rolled, profile)[0, 1])
            if r > best:
                best, best_key = r, NOTES[shift] + suffix
    return best_key


def analyze(path: str) -> dict:
    # Cap at 90s — plenty for stable tempo/key, keeps long files fast.
    y, sr = librosa.load(path, sr=22050, mono=True, duration=90)
    if y.size < sr // 2:
        return {"path": path, "error": "too short"}
    duration = float(librosa.get_duration(y=y, sr=sr))

    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    bpm = float(np.atleast_1d(tempo)[0])
    # Fold implausible tempos into the musical 60-180 range (octave errors).
    while bpm and bpm < 60:
        bpm *= 2
    while bpm > 180:
        bpm /= 2

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    key = detect_key(chroma.mean(axis=1))

    return {"path": path, "bpm": round(bpm, 1), "key": key, "duration": round(duration, 2)}


def main() -> None:
    paths = sys.argv[1:] or [line.strip() for line in sys.stdin if line.strip()]
    for p in paths:
        try:
            out = analyze(p)
        except Exception as e:  # noqa: BLE001 — report per-file, keep batch going
            out = {"path": p, "error": str(e)[:200]}
        print(json.dumps(out), flush=True)


if __name__ == "__main__":
    main()
