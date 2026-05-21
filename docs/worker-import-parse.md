# Worker handoff — POST /buddy/v2/import/parse

Phase 2c needs one new endpoint on the hippobridge Worker. I couldn't access
the worker source from this session, so the full handler is below as a
drop-in. Paste it into the existing router, wire `ANTHROPIC_API_KEY`, deploy,
and you're done.

## Contract

- **Path**: `POST /buddy/v2/import/parse`
- **Auth**: same v2 bearer/session as `/credentials` (must be authenticated)
- **Request body**: `{ "text": string }`
- **Success response** (`200`):

  ```json
  {
    "entries": [
      { "site": "", "username": "", "password": "", "url": "", "notes": "" }
    ],
    "count": 0,
    "truncated": false
  }
  ```

- **Errors**:
  - `400` invalid body (missing `text`)
  - `401` not authenticated
  - `413` body over 50 KB
  - `422` Claude returned non-JSON / unparseable output
  - `502` Anthropic API failure

The frontend (`src/routes/Import.tsx`) tolerates extra fields and unknown
shapes defensively, but follow the contract above and it will Just Work.

## Drop-in handler

```ts
// e.g. src/routes/import.ts in the hippobridge worker

const MAX_BYTES = 50 * 1024
const MAX_ENTRIES = 200
const MODEL = 'claude-sonnet-4-20250514'
const MAX_TOKENS = 4000

const SYSTEM_PROMPT =
  'You are a password import parser. The user has pasted unstructured text ' +
  'that contains login credentials — from a Word doc, notes app, browser ' +
  'export, anything. Parse it into a JSON array. Return ONLY valid JSON, no ' +
  'preamble, no markdown fences. Schema per entry: ' +
  '{site: string, username: string, password: string, url: string, notes: string}. ' +
  'If a field is missing, use empty string. Skip entries that have no password. ' +
  'Hard cap at 200 entries.'

type Env = {
  ANTHROPIC_API_KEY: string
}

type ParsedEntry = {
  site: string
  username: string
  password: string
  url: string
  notes: string
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function sanitise(raw: unknown): ParsedEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const entry: ParsedEntry = {
    site: asString(r.site),
    username: asString(r.username),
    password: asString(r.password),
    url: asString(r.url),
    notes: asString(r.notes),
  }
  if (!entry.password) return null
  return entry
}

function stripFences(text: string): string {
  // Belt + braces: in case Claude ignores the instruction and emits ```json … ```
  const trimmed = text.trim()
  if (trimmed.startsWith('```')) {
    const withoutOpen = trimmed.replace(/^```(?:json)?\s*/i, '')
    return withoutOpen.replace(/```\s*$/i, '').trim()
  }
  return trimmed
}

export async function handleImportParse(
  req: Request,
  env: Env,
): Promise<Response> {
  let body: { text?: unknown }
  try {
    body = (await req.json()) as { text?: unknown }
  } catch {
    return json(400, { error: 'invalid JSON body' })
  }
  const text = typeof body.text === 'string' ? body.text : ''
  if (!text.trim()) {
    return json(400, { error: 'missing or empty "text" field' })
  }
  const bytes = new TextEncoder().encode(text).byteLength
  if (bytes > MAX_BYTES) {
    return json(413, {
      error: `text is ${(bytes / 1024).toFixed(1)} KB — limit is 50 KB`,
    })
  }
  if (!env.ANTHROPIC_API_KEY) {
    return json(502, { error: 'parser not configured' })
  }

  let anthropicRes: Response
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text }],
      }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fetch failed'
    return json(502, { error: `Anthropic API unreachable: ${message}` })
  }

  if (!anthropicRes.ok) {
    const detail = await anthropicRes.text().catch(() => '')
    return json(502, {
      error: `Anthropic API ${anthropicRes.status}`,
      detail: detail.slice(0, 500),
    })
  }

  const payload = (await anthropicRes.json()) as {
    content?: Array<{ type?: string; text?: string }>
  }
  const raw = (payload.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')

  let parsed: unknown
  try {
    parsed = JSON.parse(stripFences(raw))
  } catch (err) {
    return json(422, {
      error: 'Claude returned non-JSON output',
      detail: err instanceof Error ? err.message : String(err),
      sample: raw.slice(0, 300),
    })
  }
  if (!Array.isArray(parsed)) {
    return json(422, {
      error: 'expected JSON array, got something else',
      sample: raw.slice(0, 300),
    })
  }

  const cleaned: ParsedEntry[] = []
  for (const item of parsed) {
    const entry = sanitise(item)
    if (entry) cleaned.push(entry)
    if (cleaned.length >= MAX_ENTRIES) break
  }
  const truncated = parsed.length > MAX_ENTRIES

  return json(200, { entries: cleaned, count: cleaned.length, truncated })
}
```

## Router wiring

Whatever router pattern the worker uses, add it next to the other
`/buddy/v2/*` routes. Example for a flat itty-router-style setup:

```ts
import { handleImportParse } from './routes/import'

// inside the existing authenticated v2 group
router.post('/buddy/v2/import/parse', requireV2Auth, (req, env) =>
  handleImportParse(req, env),
)
```

If the worker uses a single `fetch` handler with a switch on `url.pathname`,
mirror however `/buddy/v2/credentials` is dispatched and put this next to it.

## Env var

Add `ANTHROPIC_API_KEY` to the worker's secrets:

```bash
wrangler secret put ANTHROPIC_API_KEY
```

Then deploy.

## Smoke test

After deploy, with a valid session token / cookie:

```bash
curl -X POST https://hippobridge.hippoflow.workers.dev/buddy/v2/import/parse \
  -H "content-type: application/json" \
  -H "authorization: Bearer <token>" \
  --data '{"text":"GitHub login\nuser: amanda@example.com\npass: hunter2"}'
```

Expected:

```json
{
  "entries": [
    {
      "site": "GitHub",
      "username": "amanda@example.com",
      "password": "hunter2",
      "url": "",
      "notes": ""
    }
  ],
  "count": 1,
  "truncated": false
}
```
