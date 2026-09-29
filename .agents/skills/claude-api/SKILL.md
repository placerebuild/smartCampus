---
name: claude-api
description: Use when writing or modifying any code that calls the Anthropic Claude API via @anthropic-ai/sdk — message creation, streaming responses, tool use, prompt design, model selection, or token budgeting. Trigger before adding new Claude API calls, changing model IDs, adjusting max_tokens, or designing prompt templates in this project.
---

# Claude API Skill — SmartCampus SecureNet

## SDK installed

`@anthropic-ai/sdk` is in `server/package.json`. Import it in server-side code only:

```js
const Anthropic = require('@anthropic-ai/sdk');
```

The client is initialized with the API key from the environment:

```js
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
```

Guard all Claude-dependent code paths — the server starts without the key and the feature must degrade gracefully:

```js
if (!process.env.ANTHROPIC_API_KEY) {
  return res.status(503).json({ error: 'AI features are not configured.' });
}
```

## Current models (as of 2026-09)

| Model ID | Tier | Best for |
|---|---|---|
| `claude-opus-5-5` | Most capable | Complex reasoning, multi-step analysis |
| `claude-sonnet-5` | Balanced | General use, good speed/quality ratio |
| `claude-haiku-4-5-20251001` | Fast / cheap | High-volume, latency-sensitive tasks |

Default to `claude-sonnet-5` unless you need max reasoning (use Opus) or max throughput (use Haiku).

## Basic message call

```js
const message = await anthropic.messages.create({
  model: 'claude-sonnet-5',
  max_tokens: 1024,
  messages: [
    { role: 'user', content: 'Which devices have been offline for more than 5 minutes?' }
  ]
});
const text = message.content[0].text;
```

## System prompt pattern for this project

Give Claude context about the current network state so answers are grounded in real data:

```js
const systemPrompt = `You are a network monitoring assistant for SmartCampus SecureNet at DNSC.
You have access to the current device inventory and alert history.
Answer questions about device status, outages, and network health concisely.
Today's date: ${new Date().toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })}.`;

const message = await anthropic.messages.create({
  model: 'claude-sonnet-5',
  max_tokens: 512,
  system: systemPrompt,
  messages: [
    { role: 'user', content: userQuery }
  ]
});
```

## Injecting live data

Pass device/alert context as part of the user message, not the system prompt, to keep it cacheable:

```js
const devices = await getMappedDevices();
const offlineDevices = devices.filter(d => d.status === 'Offline');

const message = await anthropic.messages.create({
  model: 'claude-sonnet-5',
  max_tokens: 512,
  system: systemPrompt,
  messages: [{
    role: 'user',
    content: `Current offline devices:\n${JSON.stringify(offlineDevices, null, 2)}\n\nQuestion: ${userQuery}`
  }]
});
```

## Streaming responses

Use streaming for chat-style UIs to avoid long waits:

```js
const stream = await anthropic.messages.stream({
  model: 'claude-sonnet-5',
  max_tokens: 1024,
  messages: [{ role: 'user', content: userQuery }]
});

// With Express SSE
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');

for await (const chunk of stream) {
  if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
    res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
  }
}
res.write('data: [DONE]\n\n');
res.end();
```

## Tool use (function calling)

Define tools for structured data retrieval so Claude can query live device state:

```js
const tools = [
  {
    name: 'get_offline_devices',
    description: 'Returns the list of devices currently marked Offline',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_recent_alerts',
    description: 'Returns alerts from the last N hours',
    input_schema: {
      type: 'object',
      properties: {
        hours: { type: 'number', description: 'Look-back window in hours (default 24)' }
      },
      required: []
    }
  }
];

const message = await anthropic.messages.create({
  model: 'claude-sonnet-5',
  max_tokens: 1024,
  tools,
  messages: [{ role: 'user', content: userQuery }]
});

// Handle tool calls
if (message.stop_reason === 'tool_use') {
  const toolUse = message.content.find(b => b.type === 'tool_use');
  // execute toolUse.name with toolUse.input, then continue the conversation
}
```

## Token budgeting

| Use case | Suggested max_tokens |
|---|---|
| Single-question answers | 256–512 |
| Device/alert summaries | 512–1024 |
| Detailed analysis / reports | 1024–2048 |
| Multi-turn chat | 1024 per turn |

Keep prompts short — the device JSON can grow large. Filter to relevant fields before injecting into the prompt.

## Error handling

```js
try {
  const message = await anthropic.messages.create({ ... });
  return res.json({ answer: message.content[0].text });
} catch (err) {
  if (err.status === 429) {
    return res.status(429).json({ error: 'Rate limit reached. Try again in a moment.' });
  }
  if (err.status === 401) {
    return res.status(503).json({ error: 'AI service is misconfigured.' });
  }
  console.error('Claude API error:', err.message);
  return res.status(500).json({ error: 'AI request failed.' });
}
```

## Rate limiting

Add a separate rate limiter for AI endpoints — they are expensive and slow:

```js
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 10,              // 10 requests per minute per IP
  message: { error: 'Too many AI requests. Please wait.' }
});
app.post('/api/ai/query', requireAuth, aiLimiter, aiQueryHandler);
```
