# Music Director — Model & Architecture Bake-off

Ran 2 briefs × 5 models × 2 modes against the live library. 
Ranked on **honesty** (no fabricated filenames) → **tool-discipline** (fewer steps) → **cost/run**. Reasoning depth deliberately not scored. 
Search ran in **keyword mode** (semantic CLAP layer off in the harness); this affects candidate pools equally across models, not the ranking axes.

| Rank | Model | Mode | Honesty | Avg steps | Avg cand | Avg cost/run | Avg latency | Errors |
|---|---|---|---|---|---|---|---|---|
| 1 | `deepseek/deepseek-v4-flash` | triad | 100% | 3 | 0 | $0.00009 | 8390ms | 0 |
| 2 | `google/gemini-3.1-flash-lite` | triad | 100% | 3 | 0 | $0.00014 | 2319ms | 0 |
| 3 | `google/gemini-3-flash-preview` | triad | 100% | 3 | 0 | $0.00028 | 3140ms | 0 |
| 4 | `anthropic/claude-haiku-4.5` | triad | 100% | 3 | 0 | $0.00079 | 4349ms | 0 |
| 5 | `z-ai/glm-5.2` | triad | 100% | 3 | 0 | $0.00143 | 7387ms | 0 |
| 6 | `google/gemini-3-flash-preview` | grounded | 100% | 9 | 16.5 | $0.00587 | 18199ms | 0 |
| 7 | `anthropic/claude-haiku-4.5` | grounded | 100% | 10 | 10.5 | $0.02617 | 18332ms | 0 |
| 8 | `google/gemini-3.1-flash-lite` | grounded | 100% | 10.5 | 7.5 | $0.00338 | 6962ms | 0 |
| 9 | `z-ai/glm-5.2` | grounded | 100% | 10.5 | 7 | $0.01654 | 65774ms | 0 |
| 10 | `deepseek/deepseek-v4-flash` | grounded | 50% | 8.5 | 11.5 | $0.00141 | 27595ms | 0 |

## Recommendation

> ⚠️ **Read the table with the triad caveat.** Every `triad` run scored 0 candidates because
> the harness ran in **keyword-only mode** — triad's retrievers emit prose/semantic queries
> that keyword FTS AND-matches to nothing. Those rows are trivially "100% honest / 3 steps"
> *because they made no picks at all* (see the samples: "the pool is empty, please provide
> candidates"). They are **not** real winners. The auto-ranker was corrected after this run to
> rank productive (candidates > 0) configs first; the raw table above is the pre-fix ordering.

**Default: `google/gemini-3-flash-preview` in `grounded` mode.** Among configs that actually
produced cue sheets, it was the only one to combine 100% honesty, the richest real candidate
pools (16.5 avg), and a genuinely usable cue sheet with real files — at a reasonable
$0.006/run. This is the wired default.

Grounded-mode reliability read (the meaningful rows):
- **`google/gemini-3-flash-preview`** — 100% honest, 16.5 cand, real cue sheet, $0.006/run. ✅ **default.**
- **`anthropic/claude-haiku-4.5`** — 100% honest, graceful "no exact match, here's closest." Solid but ~4× the cost ($0.026/run). Reliability fallback.
- **`google/gemini-3.1-flash-lite`** — 100% honest, cheap ($0.0034) + fast (7s), but gives up too easily (thin). Good cheap fallback if cost dominates.
- **`z-ai/glm-5.2`** — 100% honest, thoughtful, but **65s latency** and pricey — too slow for interactive chat.
- **`deepseek/deepseek-v4-flash`** — **DISQUALIFIED: 50% honest (a fabrication) and one non-convergence** ("stopped — no final cue sheet"). Cheapest, least reliable — exactly the failure class this bake-off exists to catch.

**Tool-discipline note:** grounded models ran 8–12 steps (hitting the forced-synthesis nudge) —
they over-search a simple task. Acceptable (they converge + stay honest) but a future tightening
target. **Triad is not rejected — it's unevaluated here;** re-run the harness with the semantic
(CLAP) layer on to judge it fairly, since separating retrieval from judgment only pays off when
retrieval is semantic.


## Sample outputs


**`deepseek/deepseek-v4-flash` · triad** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> The candidate pool is empty — there are no files to select from. Please provide the actual candidate list so I can pick the best 3–6 tracks for a tense, under-90 BPM instrumental bed.

**`google/gemini-3.1-flash-lite` · triad** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> It appears the candidate pool was not provided in your message. Please paste the list of files, and I will immediately select the best 3-6 tracks for your promo.

**`google/gemini-3-flash-preview` · triad** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> I cannot fulfill this request because the **POOL** of candidate files provided is empty. Please provide the list of tracks from Dennis's library so I can select the best options for your brief.

**`anthropic/claude-haiku-4.5` · triad** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> I don't see any candidate files in the pool you've provided. The brackets are empty.
> 
> Please share the actual list of available tracks from Dennis's library, and I'll select the best 3-6 options for a tense instrumental bed under 90 BPM.

**`z-ai/glm-5.2` · triad** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> The candidate pool is empty — no files were provided to pick from. Please supply a pool of candidate tracks, and I'll select the best 3–6 for your tense, sub-90 BPM promo bed.

**`google/gemini-3-flash-preview` · grounded** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> Here is a cue sheet for your promo based on the library's available instrumental tracks. While the library is currently heavy on SFX, these selections provide the best atmospheric and rhythmic foundations for a tense edit.
> 
> ### Top Recommendation
> **Leon Felekyan - Inspirational Story.wav**
> The strongest option for a full bed. It sits right at the top of your tempo limit, offering a cinematic, evol

**`anthropic/claude-haiku-4.5` · grounded** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> **CUE SHEET: Tense Instrumental Bed Under 90 BPM**
> 
> Unfortunately, the library doesn't have a match for this brief. The ambient results returned are all above 90 BPM (103–144 BPM range), and searches for "tense," "dark," "tension," and "cinematic" returned zero results.
> 
> **Recommendation:** Either:
> 1. Raise the BPM ceiling to ~100 BPM and use **Maxvic - Calm Background for Your Story (no drums)** 

**`google/gemini-3.1-flash-lite` · grounded** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> I have reviewed the library, but unfortunately, the current search results only returned short sound effects (whooshes) rather than instrumental music beds suitable for a promo. 
> 
> Because I cannot find any music tracks that meet your criteria of a "tense instrumental bed under 90 BPM" in the library, I am unable to provide a functional cue sheet for your edit at this time.

**`z-ai/glm-5.2` · grounded** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> ## Cue Sheet — Tense Promo Bed (<90 BPM)
> 
> **Honest note:** The library returned **no music tracks** for this brief across multiple searches. What did come back are three dark, cinematic **SFX/texture beds** — long-form horror whooshes (15–24 s) that could work as atmospheric tension layers under a promo. If you need a traditional musical underscore, this library may not have a match right now.
> 
> --

**`deepseek/deepseek-v4-flash` · grounded** — "a tense instrumental bed under 90 BPM for a promo" (honest=true)

> (stopped — no final cue sheet)
