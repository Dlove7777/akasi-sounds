# Akasi Sounds — MCP door

Exposes your local sound library to agents (Claude, Hermes Music Director, any MCP
client) over stdio. Read-only in effect (no write tools); semantic search uses the
same local CLAP model the app uses.

## Tools
- **search_sounds** — keyword + natural-language ("tense metallic riser") search with
  filters: `kind`, `genre`, `instrumental`, `bpmMin/Max`, `durMin/Max`, `limit`.
- **get_sound** — full metadata + file path for an id.
- **list_collections** — collections with counts.
- **library_stats** — totals, genres, and whether AI search is warm.

## Wire it up

The door runs under the app's Electron ABI via `mcp/run.sh`. Add to your MCP client:

**Claude Code** (`claude mcp add`):
```bash
claude mcp add akasi-sounds -- /Users/dennislovelace/code/akasi/akasi-sounds/mcp/run.sh
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "akasi-sounds": { "command": "/Users/dennislovelace/code/akasi/akasi-sounds/mcp/run.sh" }
  }
}
```

## Notes
- Reads `~/Library/Application Support/Akasi Sounds/akasi-sounds-index.db`; override
  with `AKASI_SOUNDS_DB`. Launch the app once first so the DB exists.
- Semantic search activates after the CLAP model warms (~5s) **and** once the library
  has been analyzed (⚡ Analyze in the app). Until then it's keyword-only — still fully
  functional, just no "describe the sound" matching.
- No write tools are exposed, so an agent can search and read but never mutate your
  library.
