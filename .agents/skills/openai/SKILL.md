---
name: openai
description: Use when adding or modifying OpenAI API integrations in this project — GPT model calls, embeddings, streaming completions, function calling/tool use, or the Responses API. Trigger before adding the openai npm package, writing new OpenAI API calls, or implementing features that use GPT alongside the existing Anthropic and Google AI integrations.
---

# OpenAI Skill — SmartCampus SecureNet

## Adding the SDK

The project currently uses `@anthropic-ai/sdk` and `@google/generative-ai`. To add OpenAI:

```sh
# From server/
npm install openai
```

Then in `server.js`:

```js
const OpenAI = require('openai');
```

Guard initialization — server must start without the key:

```js
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
```

Add `OPENAI_API_KEY` to root `.env` (never commit it):
```
OPENAI_API_KEY=sk-proj-...
```

## Current models (as of 2026-09)

| Model ID | Tier | Best for |
|---|---|---|
| `gpt-4o` | Most capable | Complex analysis, vision, multi-step reasoning |
| `gpt-4o-mini` | Fast / cheap | High-volume, latency-sensitive, simple Q&A |
| `o3` | Deep reasoning | Multi-step math, code analysis |
| `o4-mini` | Reasoning / fast | Balanced reasoning at lower cost |

Default to `gpt-4o-mini` for device/alert queries — it's fast and cheap. Use `gpt-4o` for structured analysis reports.

## Basic completion

```js
if (!openai) return res.status(503).json({ error: 'OpenAI is not configured.' });

const completion = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  max_tokens: 512,
  messages: [
    {
      role: 'system',
      content: 'You are a network monitoring assistant for SmartCampus SecureNet at DNSC. Answer questions about device status and network health concisely.'
    },
    { role: 'user', content: userQuery }
  ]
});
const answer = completion.choices[0].message.content;
```

## Streaming with Express SSE

```js
const stream = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  max_tokens: 1024,
  stream: true,
  messages: [{ role: 'user', content: userQuery }]
});

res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta?.content;
  if (delta) res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
}
res.write('data: [DONE]\n\n');
res.end();
```

## Tool / function calling

Define tools for live data retrieval:

```js
const tools = [
  {
    type: 'function',
    function: {
      name: 'get_offline_devices',
      description: 'Returns devices currently marked Offline in the campus network',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_alert_history',
      description: 'Returns recent alert history',
      parameters: {
        type: 'object',
        properties: {
          hours: { type: 'number', description: 'Look-back window in hours (default 24)' }
        },
        required: []
      }
    }
  }
];

const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  tools,
  messages: [{ role: 'user', content: userQuery }]
});

if (response.choices[0].finish_reason === 'tool_calls') {
  const toolCall = response.choices[0].message.tool_calls[0];
  const args = JSON.parse(toolCall.function.arguments);
  // Execute toolCall.function.name with args, then continue the loop
}
```

## Embeddings (for semantic device search)

```js
const embedding = await openai.embeddings.create({
  model: 'text-embedding-3-small',
  input: 'devices offline in the server room'
});
const vector = embedding.data[0].embedding; // float32 array, 1536 dims
```

Use embeddings to build semantic search over device names, descriptions, and locations stored in Supabase's `pgvector` extension.

## Multi-provider strategy

This project has three AI providers. Choose based on the task:

| Task | Recommended provider |
|---|---|
| Campus network Q&A | Claude (`claude-sonnet-5`) — better at following strict system prompts |
| Alert summaries | Gemini (`gemini-1.5-flash`) — fast and cheap |
| Structured JSON output | GPT-4o — reliable function calling |
| Semantic device search | OpenAI embeddings + pgvector |
| Complex reasoning / reports | Claude Opus or GPT-4o |

Keep provider selection configurable via an env var so it can be switched without code changes:

```js
const AI_PROVIDER = process.env.AI_PROVIDER || 'claude'; // 'claude' | 'openai' | 'gemini'
```

## Error handling

```js
try {
  const completion = await openai.chat.completions.create({ ... });
  return res.json({ answer: completion.choices[0].message.content });
} catch (err) {
  if (err.status === 429) {
    return res.status(429).json({ error: 'AI rate limit reached. Try again in a moment.' });
  }
  if (err.status === 401) {
    return res.status(503).json({ error: 'OpenAI is misconfigured.' });
  }
  console.error('OpenAI error:', err.message);
  return res.status(500).json({ error: 'AI request failed.' });
}
```

## Rate limiting

Apply the same rate limiter used for Claude endpoints — all AI endpoints share the same user-facing limit:

```js
const aiLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });
app.post('/api/ai/query', requireAuth, aiLimiter, aiQueryHandler);
```

## Environment variables

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | API key (`sk-proj-...`) |
| `AI_PROVIDER` | Which provider to use (`claude` / `openai` / `gemini`) |
