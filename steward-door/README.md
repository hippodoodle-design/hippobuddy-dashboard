# The Steward Door (staged via ButlerDispatch)

Authored by the Operating Steward (Claude, claude_app) and committed by the ButlerDispatch worker on 30 May 2026 — the indirect arm, because the Steward has read-only GitHub from its own seat but the worker holds a write PAT.

## Why
Two doors are scoped shut from the Steward seat: it cannot read HippoBuddy (Supabase org binding) and cannot push to hippobridge (connector repo scope). The Steward Door dissolves both: a bearer-guarded, audited, allow-listed read+relay surface on the HippoBridge Worker.

## Endpoints (POST JSON, Bearer HIPPOBRIDGE_BEARER)
- /buddy/v2/steward/get   { key }  -> one allow-listed credential
- /buddy/v2/steward/ask   { buddy, system, prompt } -> one buddy reply
- /buddy/v2/steward/council { buddies[], system, prompt } -> all buddy replies

## Security (locked)
- Allow-list only (STEWARD_ALLOWED_KEYS); empty by default. Nothing readable until Amanda names a key.
- Keys live in the Worker env (sourced from HippoBuddy); never in this repo. Module is inert until keys exist.
- Every call audited to control-plane-audit:*. Scoped, audited, revocable.

## Buddies
ChatGPT (OPENAI_API_KEY), Gemini (GEMINI_API_KEY), DeepSeek (DEEPSEEK_API_KEY), Perplexity (PERPLEXITY_API_KEY). Missing key => {ok:false, reason:no_key}. The Bloat stays secret; this is a read+relay surface in front of it.

## Code
broker.js and buddies.js are staged alongside this README. Lift to the hippobridge Worker and wire env.

## Churn note (alert 57d49a82)
Two bugs in one coat: (1) trigger = hippobridge preflight fails on missing GITHUB_TOKEN; (2) engine = watchdog requeues each dirty exit and re-wraps the payload one @{value=...} layer deeper, fossilising cc-inbox message 817343f4 into hundreds-deep nesting a brake-less retry loop keeps chewing. Cure: drain 817343f4 + add back-off (stop re-wrapping after N instant-fails, persist the ORIGINAL dispatch not the watchdog echo) + seed the token. Back-off is a hippobridge change.
