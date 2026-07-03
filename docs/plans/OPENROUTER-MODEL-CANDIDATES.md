# OpenRouter Model Candidates — Music Director tool-calling loop

Researched 2026-07-02 for the Akasi Sounds in-app "Music Director": a small tool-calling loop
(search local sound library → pick 3-6 files → write a short cue sheet). This is a **reliability**
problem, not an intelligence problem. Priorities in order: (a) never hallucinate file names/paths,
(b) clean OpenAI-style `tool_calls`, converges fast, no keyword-salad over-exploring, (c) cheap
$/token (runs on every chat).

All prices are per 1M tokens, USD, as listed on OpenRouter's own model pages at fetch time.
OpenRouter list prices are pre-prompt-caching; several providers advertise 60-80% effective
discounts with caching, which is relevant here since the tool loop re-sends a growing transcript.

## Candidate table

| Model | Slug | $in/$out per Mtok | Context | Tools | Released | Notes |
|---|---|---|---|---|---|---|
| Gemini 3.5 Flash | `google/gemini-3.5-flash` | $1.50 / $9.00 | 1M | Yes | 2026-05-19 | Newest **non-preview** Flash; "near-Pro coding/reasoning at Flash cost." Priciest of the Flash line here — output cost is steep for a loop that writes cue-sheet text. |
| Gemini 3 Flash Preview | `google/gemini-3-flash-preview` | $0.50 / $3.00 | 1M | Yes | 2025-12-17 | OpenRouter's own copy: "designed for agentic workflows... near Pro-level reasoning **and tool use** performance with substantially lower latency." Best-documented tool-use fit of the Flash family. |
| Gemini 3.1 Flash Lite (GA) | `google/gemini-3.1-flash-lite` | $0.25 / $1.50 | 1M | Yes | ~2026-03 (GA) | Cheapest current Gemini with tool calling; Google Cloud blog confirms GA. Good low-cost baseline. |
| Gemini 3.1 Flash Lite Preview | `google/gemini-3.1-flash-lite-preview` | $0.25 / $1.50 | 1M | Yes | 2026-03-03 | Preview channel of the above; same price. Prefer the GA slug for production. |
| GLM 5.2 | `z-ai/glm-5.2` | $0.93 / $3.00 | 1M | Yes | 2026-06-16 | **Confirmed inside the 2-week window.** 744B/40B-active MoE, MIT-licensed weights, 13+ OpenRouter providers. Independent coverage: "nearly ties Opus [4.8] on MCP-Atlas" tool-use benchmark. This is Zhipu's flagship, not a cheap variant — solid but not the cheapest option here. One secondary source quoted $1.40/$4.40; the model's own OpenRouter pricing page (fetched directly) confirms **$0.93/$3.00**, so treat that as authoritative. |
| GLM 4.7 | `z-ai/glm-4.7` | $0.40 / $1.75 | 203K | Yes | 2025-12-22 | Prior-gen Zhipu, cheaper than 5.2, smaller context. "Enhanced programming... more stable multi-step reasoning/execution" per OpenRouter copy — Zhipu's own framing is aimed at agentic stability. Not from the last 2 weeks (incumbent baseline). |
| DeepSeek V4 Flash | `deepseek/deepseek-v4-flash` | $0.089 / $0.18 | 1M | Yes | 2026-04-24 | Cheapest capable model found. 284B/13B-active MoE. Not brand-new but a strong cost baseline — 10-30x cheaper than the others per token. |
| Claude Haiku 4.5 | `anthropic/claude-haiku-4.5` | $1.00 / $5.00 | 200K | Yes | (incumbent, pre-window) | Known-reliable tool-calling baseline; Anthropic's own tool-use discipline (strict schema adherence) is well documented. Priciest per-output-token of the practical set. |
| GPT-5 Mini | `openai/gpt-5-mini` | $0.25 / $2.00 | 400K | Yes | (incumbent, pre-window) | OpenAI mini baseline, confirmed tool/function-calling + vision. Reasonable cost, large context headroom. |

### Explicitly UNVERIFIED / not confirmed
- **No Gemini Flash release newer than `google/gemini-3.5-flash` (2026-05-19) was found.** I could not confirm a Gemini Flash launch inside the June 18 – July 2, 2026 window despite targeted searches (Google Cloud blog, `ai.google.dev` changelog, OpenRouter Google provider page). If Dennis saw a specific announcement, send the link/name and I'll re-verify the exact slug rather than guess.
- **No smaller/cheaper Zhipu GLM release (e.g. a hypothetical "GLM-5.2-Air" or "GLM-4.8") was found** — only GLM-5.2 (flagship, confirmed 2026-06-16) and the older GLM-4.7 turned up. Zhipu's naming has jumped straight from 4.7 → 5 → 5.1 → 5.2; no lightweight 5.x variant is listed on OpenRouter as of fetch time.
- GLM-5.2 pricing had one conflicting secondary-source figure ($1.40/$4.40, from a news aggregator) vs. the OpenRouter pricing page itself ($0.93/$3.00). Went with the direct OpenRouter fetch as ground truth but flagging the discrepancy — worth a live spot-check against the OpenRouter dashboard before committing budget math.
- Did not find or verify a "Gemini Flash Lite" or GLM variant priced under DeepSeek V4 Flash's $0.089/$0.18 — if true rock-bottom cost is the deciding factor, DeepSeek V4 Flash is the floor among verified options.

## Shortlist to bake off

Ordered by expected fit for cheap + reliable + tool-disciplined, for a loop that does ~2-4 tool
calls (search library, maybe refine search, emit final cue sheet) and must never invent filenames.

1. **`google/gemini-3-flash-preview`** — $0.50/$3.00, 1M ctx. Best documented fit: OpenRouter's own listing calls out "near Pro-level reasoning **and tool use**" specifically, at a real discount vs. 3.5 Flash. Good default pick until a genuinely newer Flash surfaces.
2. **`z-ai/glm-5.2`** — $0.93/$3.00, 1M ctx. The verified last-2-weeks release the user flagged. Independent benchmark (MCP-Atlas) specifically measures tool-use quality and puts it near Opus 4.8 — strong signal for tool-discipline, not just raw intelligence. Worth baking off even though it's priced above the Gemini/DeepSeek options, since honesty/convergence quality may justify it.
3. **`deepseek/deepseek-v4-flash`** — $0.089/$0.18, 1M ctx. The cost floor by a wide margin (5-10x cheaper than everything else here). Include as the "is cheap-enough tool-calling good-enough" control — if it holds up on honesty/convergence in the bake-off, it changes the cost math for running this on every chat.
4. **`google/gemini-3.1-flash-lite`** (GA) — $0.25/$1.50, 1M ctx. Second-cheapest verified option with tool calling and a real GA (not preview) status — lower operational risk than relying on a `-preview` slug for a production feature.
5. **`anthropic/claude-haiku-4.5`** — $1.00/$5.00, 200K ctx. Reliability baseline/control: Anthropic's tool-calling and schema-adherence reputation is the most battle-tested of the set, useful as the "gold standard reliability" comparison point even though it's the most expensive per-output-token candidate.

Not shortlisted but noted: `z-ai/glm-4.7` (cheaper than 5.2 but pre-window, smaller 203K context) and
`openai/gpt-5-mini` (solid incumbent, no strong tool-use differentiation found vs. the above) as
backups if the top 5 underperform in testing.

## Sourcing

Fetched/searched live on 2026-07-02:
- https://openrouter.ai/google/gemini-3-flash-preview (WebFetch — slug, price, context, tools, release date)
- https://openrouter.ai/google/gemini-3.5-flash (WebFetch — slug, price, context, release date)
- https://openrouter.ai/google/gemini-3.1-flash-lite-preview (WebFetch — slug, price, context, release date)
- https://openrouter.ai/z-ai/glm-4.7 (WebFetch — slug, price, context, release date)
- https://openrouter.ai/z-ai/glm-5.2 (WebFetch — slug, price, context, release date)
- https://openrouter.ai/z-ai/glm-5.2/pricing (WebFetch — provider-level price confirmation)
- https://openrouter.ai/deepseek/deepseek-v4-flash (WebFetch — slug, price, context, release date)
- https://openrouter.ai/blog/announcements/ (WebFetch — checked for any June 18–July 2 2026 model-launch posts; none found, only MCP Server / Image API / Subagent feature posts)
- WebSearch: "OpenRouter models.dev Gemini Flash new release June 2026"
- WebSearch: "Zhipu GLM-4.x new model release June 2026 OpenRouter"
- WebSearch: "OpenRouter new models announced June 2026 cheap tool calling"
- WebSearch: "\"gemini-3.1-flash\" OpenRouter slug pricing site:openrouter.ai"
- WebSearch: "GLM-5.2 OpenRouter slug \"z-ai/glm-5.2\"" (sources include technology.org, trendingtopics.eu, cnbc.com coverage of the 2026-06-16 GLM-5.2 launch)
- WebSearch: "GLM-4.9 OR \"GLM-4.8\" Zhipu Z.ai cheap model June 2026 OpenRouter" (confirmed no smaller GLM-5.x variant exists yet)
- WebSearch: "Claude Haiku 4.5 OpenRouter pricing slug tool calling"
- WebSearch: "DeepSeek V4 Flash OpenRouter pricing slug tool calling"
- WebSearch: "OpenAI GPT-5 mini OR \"gpt-5.1-mini\" OpenRouter pricing slug tool calling 2026"
- WebSearch: "\"Gemini 3.1 Flash\" release date Google DeepMind announcement (not lite, not preview)"

### Flagged as NOT verified — do not treat as fact
- Any Gemini Flash release strictly newer than `google/gemini-3.5-flash` (2026-05-19). None found.
- Any GLM model cheaper/smaller than `z-ai/glm-5.2` released after GLM-4.7. None found.
- The $1.40/$4.40 GLM-5.2 price quoted by one news aggregator (technology.org) — superseded by the
  $0.93/$3.00 figure pulled directly from OpenRouter's own pricing page for the model.
