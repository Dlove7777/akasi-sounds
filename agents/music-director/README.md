# Akasi Music Director

A local agent that turns a music/SFX brief into a curated cue sheet by driving the
[Akasi Sounds MCP door](../../mcp/README.md) with a tool-calling LLM. Model-agnostic
and **local-first** — points at Ollama by default, works with OpenRouter (Hermes'
current brain) or any OpenAI-compatible endpoint.

## Run it standalone

```bash
# Local brain on M1's Ollama over the tailnet:
OPENAI_BASE_URL=http://m1:11434/v1 DIRECTOR_MODEL=qwen2.5:32b \
  node agents/music-director/director.js "tense instrumental bed under 90 bpm for a promo"

# Prove the plumbing without an LLM (agent → MCP → library):
node agents/music-director/director.js --dry "corporate motivational"
```

Config via env: `OPENAI_BASE_URL` (default `http://localhost:11434/v1`),
`OPENAI_API_KEY` (default `ollama`), `DIRECTOR_MODEL` (default `qwen2.5:32b`).
For OpenRouter: set `OPENAI_BASE_URL=https://openrouter.ai/api/v1`, `OPENAI_API_KEY=$OPENROUTER_KEY`,
`DIRECTOR_MODEL=qwen/qwen-2.5-72b-instruct`.

## Wire into Hermes (Slack)

Hermes already runs an MCP-capable agent loop on M1. To give it Music Director powers:
1. Register the MCP door in Hermes' MCP config (command → this repo's `mcp/run.sh`,
   reachable on the machine that holds the library, or exposed over the tailnet).
2. Append [`PROMPT.md`](PROMPT.md) to the persona used for `#akasi-hermes` music
   requests (or add a `music director` intent that loads it).
3. Ask in Slack: *"@hermes find me 3 tense instrumental beds under 90 BPM for SkipMyW2"* —
   it searches the real library and replies with a cue sheet + file paths.

The door exposes **no write tools**, so the agent can search and read but never mutate
the library.

## Best results
Run **⚡ Analyze** in the app first so BPM/key/genre/instrumental and the CLAP
embeddings exist — then the director can search by *feel* ("driving, hopeful, no
vocals") and filter by real tempo, not just filename keywords.
