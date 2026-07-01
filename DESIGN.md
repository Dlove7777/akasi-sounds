# Akasi Sounds — Design System

**Feel:** a quiet, pro audio tool. Dark studio surface, content-forward, zero chrome
noise. It should sit next to Premiere/Resolve without looking like a consumer app.

## Color
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0e0f13` | app background |
| `--panel` | `#15171e` | sidebar, dock |
| `--panel-2` | `#1b1e27` | inputs, badges, raised chips |
| `--border` | `#23262f` | hairlines |
| `--text` | `#e6e8ee` | primary text |
| `--muted` | `#868c9c` | secondary text, tags, meta |
| `--accent` (teal) | `#4fd1c5` | waveform (played), active nav, primary action |
| `--accent-2` (amber) | `#f0b429` | playhead, favorites ★, activity |

Two accents only. Teal = "sound / active", amber = "position / marked". Everything
else is neutral grey.

## Type
System stack (`-apple-system`/Inter). Sizes: 17px brand, 13.5px rows/nav, 12–12.5px
meta, 10.5px uppercase section labels (letter-spacing .8px). Tabular numerals for
durations and timecodes.

## Layout
- Two-pane: 232px sidebar + fluid main.
- Main is a 3-row grid: search bar / results list / waveform dock (pinned bottom).
- `titleBarStyle: hiddenInset`; sidebar top-padded 38px to clear macOS traffic lights;
  the search bar is a drag region (`-webkit-app-region`).
- 8–9px radii, dashed borders for "add"/"drop" affordances.

## Motion
Restrained — .12–.14s background/border transitions on hover/active only. No bounce,
no entrance animation. The waveform + playhead are the only live elements.

## Principles
1. The list is the product — keep rows dense, scannable, one line each.
2. License is always visible (CC0 / CC BY / local) — credit is a feature, not fine print.
3. The drag handle is always reachable while a sound is selected.
4. Empty states teach the next action ("add a folder or search Freesound").
