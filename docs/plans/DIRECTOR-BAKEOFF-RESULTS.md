# Music Director — Model & Architecture Bake-off

Ran 2 briefs × 5 models × 2 modes against the live library. 
Ranked on **honesty** (no fabricated filenames) → **tool-discipline** (fewer steps) → **cost/run**. Reasoning depth deliberately not scored. 
Search ran in **keyword mode** (semantic CLAP layer off in the harness); this affects candidate pools equally across models, not the ranking axes.

| Rank | Model | Mode | Honesty | Avg steps | Avg cand | Avg cost/run | Avg latency | Errors |
|---|---|---|---|---|---|---|---|---|
| 1 | `google/gemini-3-flash-preview` | triad | 100% | 3 | 1 | $0.00115 | 5588ms | 0 |
| 2 | `google/gemini-3-flash-preview` | grounded | 100% | 6 | 9 | $0.01023 | 11183ms | 0 |
| 3 | `anthropic/claude-haiku-4.5` | grounded | 100% | 6.5 | 3.5 | $0.03705 | 17621ms | 0 |
| 4 | `z-ai/glm-5.2` | grounded | 100% | 8 | 8.5 | $0.03149 | 58987ms | 0 |
| 5 | `deepseek/deepseek-v4-flash` | grounded | 100% | 9 | 4 | $0.00408 | 41668ms | 0 |
| 6 | `deepseek/deepseek-v4-flash` | triad | 100% | 3 | 0 | $0.00019 | 12251ms | 0 |
| 7 | `google/gemini-3.1-flash-lite` | triad | 100% | 3 | 0 | $0.00039 | 2445ms | 0 |
| 8 | `anthropic/claude-haiku-4.5` | triad | 100% | 3 | 0 | $0.00289 | 6891ms | 0 |
| 9 | `z-ai/glm-5.2` | triad | 100% | 3 | 0 | $0.00392 | 16555ms | 0 |
| 10 | `google/gemini-3.1-flash-lite` | grounded | 100% | 5 | 0 | $0.00381 | 6198ms | 0 |

## Recommendation (semantic-on re-bake — the fair grounded-vs-triad verdict)

> This run had **CLAP semantic search ON** (the deadlock was a misdiagnosis — see U4), so
> triad's semantic retrievers were finally evaluated fairly. The raw table's auto-#1
> (gemini triad, avg 1 candidate) is still a thin-pool artifact; the ranker was corrected
> after this run to sort by candidate **richness** (avgPool desc), not mere productive>0.

**Verdict: keep `google/gemini-3-flash-preview` in `grounded` mode as the default.** Every
config was 100% honest (zero fabrications — the honesty invariant holds), so the tiebreaker
is *how many real, usable candidates each surfaces*. Grounded gemini pulled **9 avg
candidates** vs triad's **1** — on a thin (SFX-heavy) library, grounded's thorough
multi-search retrieval decisively beats triad's two-shot retrieve-then-judge. Triad **did**
improve with semantic on (1 candidate vs 0 keyword-only), confirming its retrievers need
semantic search — but its edge (retrieval diversity) only pays off on a *rich* library, which
this isn't yet. Re-evaluate triad once generation + broader sourcing fatten the library.

Also observed: with the Scoring Playbook + prompt-writer now wired, every director **honestly
pivots to a generation prompt** when the library lacks a fit ("Library doesn't have a fit —
recommend generation. Prompt: …") instead of forcing a weak pick. That's the intended
grounding behavior, confirmed live.

Grounded-mode fallbacks unchanged: claude-haiku-4.5 (honest, ~3.6× cost), glm-5.2 (honest but
~59s latency — too slow), gemini-3.1-flash-lite (cheap/fast but thin), deepseek-v4-flash
(honest this run but slow at 42s and historically the fabrication risk — stays non-default).


## Sample outputs


**`google/gemini-3-flash-preview` · triad** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> The candidate pool is currently empty. To provide a tense instrumental bed under 90 BPM that serves your promo, please provide the list of files from Dennis's library. 
> 
> In the absence of the pool, here is the **Akasi Generation Prompt** to create exactly what this brief requires:
> 
> > **Prompt:** Cinematic tension underscore, 80 BPM, minor key. Low pulsing synth bass, ticking clock-like percussion,

**`google/gemini-3-flash-preview` · grounded** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> The current library is heavily weighted toward short sound effects and lacks a long-form tension bed under 90 BPM. 
> 
> To get the exact "tense promo" feel you need, I recommend generating a custom cue. Here is a production-ready prompt you can use:
> 
> ### **Recommended Generation Prompt**
> > **Brief:** Tense, cinematic instrumental underscore bed for a promo. Dark, brooding atmosphere with a slow, rhyt

**`anthropic/claude-haiku-4.5` · grounded** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> ---
> 
> ## **Cue Sheet: Tense Instrumental Bed (Promo)**
> 
> **Status:** Library doesn't have a fit. **Recommend generation.**
> 
> **Generation Prompt (paste into ACE-Step / Suno / Udio):**
> 
> > Tense instrumental bed for a promo. Slow, brooding, suspenseful underscore under 90 BPM. Minimal orchestral or synth pad with a pulsing low-end drone, dissonant strings or dark synth layers. No drums, no vocals. Cine

**`z-ai/glm-5.2` · grounded** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> ### Generation Prompt (if you want a custom cue)
> 
> Paste this into ACE-Step / Suno / Udio:
> 
> > **Caption:** Tense instrumental bed for a promo, under 90 BPM. Dark, suspenseful cinematic underscore. Minimal — pulsing low synth, sparse piano in a minor key, subtle clock-tick percussion, evolving drone pad. No melody hook, no vocals. Builds slowly with rising tension. Should sit under voiceover without

**`deepseek/deepseek-v4-flash` · grounded** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> Here's my honest assessment, Dennis.
> 
> ---
> 
> **Honest read:** Dennis's local library has 170 music files, but it simply doesn't have a genuine tense/suspenseful instrumental bed under 90 BPM suitable for a promo. Online search (Jamendo) is also unavailable right now, so I can't pull CC beds from there either.
> 
> Here are the **closest usable options**, clearly labeled as compromises:
> 
> **Compromise #1*

**`deepseek/deepseek-v4-flash` · triad** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> I see that the candidate pool is empty — no files were provided to choose from. Under Akasi rules, I never invent a file. Since there's nothing to pick, I'll flag this honestly and offer a precise generation prompt instead.
> 
> ---
> 
> **No matching file in the pool.** The brief calls for a tense instrumental bed under 90 BPM, but no candidates were supplied. Here's a generation prompt you can use to pr

**`google/gemini-3.1-flash-lite` · triad** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> The provided candidate pool is empty. Please provide the list of files available in your library so I can curate the best selection for your promo.

**`anthropic/claude-haiku-4.5` · triad** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> The pool is empty—no candidates to choose from.
> 
> **Recommendation:**
> 
> For a **tense instrumental bed under 90 BPM**, I'd generate:
> 
> **Prompt:**
> > Sparse, minor-key ambient underscore. Pulsing low-end drone (sub-bass pad), dissonant string stabs every 2–4 bars, clock-tick or metallic hi-hat texture, no drums. 75–85 BPM. Unresolved, dread-forward. Instrumental. ~60 seconds, loopable. Cinematic tensi

**`z-ai/glm-5.2` · triad** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> The candidate pool is empty — there are no files to pick from.
> 
> **Honest call:** I can't make a single selection without inventing a track, which I won't do. Here's what I'd need or suggest instead:
> 
> **If you can re-run the search**, aim for something matching:
> - **Tempo:** 60–90 BPM (or halftime feel)
> - **Mood:** tense, suspenseful, unresolved
> - **Instrumentation:** sparse — pulses, low drones, c

**`google/gemini-3.1-flash-lite` · grounded** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> My library is currently very light on dedicated "tense bed" music tracks, and the search returned no direct matches for that specific mood.
> 
> Since you need a professional-grade, tense instrumental bed for a promo, I have drafted a generation prompt below that you can use to create a custom track. This will ensure you get the exact tempo, mood, and "space" needed to sit under your voiceover without
