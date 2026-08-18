# Akasi Sounds instructions

## What this repo is

Akasi Sounds is an Electron + React/Vite local-first SFX manager with SQLite/FTS5,
Freesound, ffmpeg, and native NLE drag-out. Treat `package.json` scripts and build settings as authoritative.

## Routing rules

- Thinking, architecture, strategy, and personal notes belong in the iCloud vault; agents write there only in `vault/agent-notes/`.
- System configuration belongs in `akasi-systems`; reusable IP belongs in `akasi-ip`.
- Client-specific facts, decisions, delivery state, and configuration stay only in the relevant client repo. Never pool client memory.
- Client deliverables belong in client `/deliverables`, then Google Drive for delivery.

## Durable memory

- Read relevant records at session start. Append durable facts with `YYYY-MM-DD`; never delete, rewrite, or overwrite history.
- State what changed, why, evidence/source, and unresolved follow-up. Keep durable agent state in repos, not the vault except `agent-notes/`.

## Safety

- Never commit, paste, log, or echo secret values, private keys, tokens, credentials, or `.env` contents. Record locations, owners, scopes, and rotation steps only.
- Check `.gitignore` first. If a secret is exposed, stop and report rotation is required.
- Do not broaden access, deploy, send, spend, or delete without sign-off.

## Voice and formatting

- Write concise, plain, complete sentences. Lead with outcome; record evidence, assumptions, and concrete blockers.
- Preserve product conventions and make focused, reviewable changes.

## Dennis sign-off required

- Repository lifecycle, GitHub permissions, client/cross-client access, vault changes outside `agent-notes/`.
- Production changes, purchases, billing, external messages, deletion, client-data moves, scope changes, or publication.
