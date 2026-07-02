'use strict';
/**
 * Akasi Music Director — a local agent that turns a music brief into a curated cue
 * sheet by driving the Akasi Sounds MCP door with an OpenAI-compatible LLM
 * (local Ollama by default; OpenRouter or any compatible endpoint via env).
 *
 *   node director.js "tense instrumental bed under 90 bpm for a promo"
 *   node director.js --dry "..."     # skip the LLM; just prove the tool plumbing
 *
 * Config (env):
 *   OPENAI_BASE_URL   default http://localhost:11434/v1  (Ollama; use M1 over tailnet)
 *   OPENAI_API_KEY    default "ollama"
 *   DIRECTOR_MODEL    default "qwen2.5:32b"
 */
const path = require('node:path');
const fs = require('node:fs');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const ROOT = path.join(__dirname, '..', '..');
const BASE_URL = process.env.OPENAI_BASE_URL || 'http://localhost:11434/v1';
const API_KEY = process.env.OPENAI_API_KEY || 'ollama';
const MODEL = process.env.DIRECTOR_MODEL || 'qwen2.5:32b';
const SYSTEM = fs.readFileSync(path.join(__dirname, 'PROMPT.md'), 'utf8');

async function connectDoor() {
  const client = new Client({ name: 'music-director', version: '0.1.0' });
  await client.connect(new StdioClientTransport({ command: path.join(ROOT, 'mcp', 'run.sh') }));
  const { tools } = await client.listTools();
  return { client, tools };
}

// MCP tool schema → OpenAI tool schema
const toOpenAiTools = (tools) =>
  tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));

async function chat(messages, tools) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, tools, temperature: 0.4 }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text().catch(() => '')}`);
  return (await res.json()).choices[0].message;
}

async function run(brief, dry) {
  const { client, tools } = await connectDoor();
  try {
    if (dry) {
      // Prove the plumbing without an LLM: run one representative search.
      const r = await client.callTool({
        name: 'search_sounds',
        arguments: { query: brief, limit: 5 },
      });
      console.log(r.content[0].text);
      return;
    }
    const oaTools = toOpenAiTools(tools);
    const messages = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: brief },
    ];
    for (let step = 0; step < 6; step++) {
      const msg = await chat(messages, oaTools);
      messages.push(msg);
      if (!msg.tool_calls?.length) {
        console.log('\n' + (msg.content || '(no answer)'));
        return;
      }
      for (const call of msg.tool_calls) {
        let args = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* bad json */ }
        process.stderr.write(`  ↳ ${call.function.name}(${JSON.stringify(args)})\n`);
        const out = await client.callTool({ name: call.function.name, arguments: args });
        messages.push({ role: 'tool', tool_call_id: call.id, content: out.content[0].text });
      }
    }
    console.log('(stopped after 6 steps — no final answer)');
  } finally {
    await client.close();
  }
}

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const brief = args.filter((a) => a !== '--dry').join(' ').trim();
if (!brief) {
  console.error('usage: node director.js [--dry] "<music brief>"');
  process.exit(1);
}
run(brief, dry).catch((e) => { console.error('director error:', e.message); process.exit(1); });
