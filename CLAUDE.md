# HippoBuddy v2 — Dashboard

Front-end for the HippoBuddy v2 patient/owner dashboard. This repo is the SPA that will eventually call the HippoBridge Worker for v2 data flows.

## Tech stack

- Vite + React + TypeScript
- Tailwind CSS (3.x)
- react-router-dom (SPA routing: `/`, `/enrol`, `/login`, `/dashboard`)
- Deployed to Vercel as a static SPA with a catch-all rewrite to `index.html` (see `vercel.json`)

## Phase scope

### Phase 2a — current (scaffold only)

This phase creates the empty shell:

- Four routes wired up (Home, Enrol, Login, Dashboard) — each renders the same "HippoBuddy v2 — coming soon" placeholder card on a calming sky → teal → emerald gradient.
- No auth, no API calls, no real UI yet.
- Pushed to `hippodoodle-design/hippobuddy-dashboard`, deployed to its default `*.vercel.app` URL.
- **No custom domain** — that's a Phase 2b prerequisite, configured separately.

### Phase 2b — next (locked decisions)

- **Passkey enrolment via WebAuthn PRF (Option B).** Locked 2026-05-20. The PRF extension derives a per-user symmetric key from the passkey, which becomes the encryption key for client-side encrypted data — no server-side key escrow, no separate password.
- Custom domain wired up on Vercel (TBD).
- First real UI: `/enrol` flow (create passkey + derive PRF key + register with Worker).

## Worker endpoints

The dashboard will talk to the HippoBridge Worker at:

```
https://hippobridge.hippoflow.workers.dev/buddy/v2/*
```

Exact endpoint shape lands in Phase 2b. Expect `/buddy/v2/enrol`, `/buddy/v2/login`, etc.

## Encryption decision

- **Option B: WebAuthn PRF** is the chosen client-side key derivation method.
- Rationale: avoids a separate password, derives a strong symmetric key from the authenticator, and works without server-side key material.
- Client encrypts sensitive payloads before sending to the Worker; the Worker only sees ciphertext + minimal metadata.

## Dev

```
npm install
npm run dev      # local dev server (Vite)
npm run build    # production build to ./dist
npm run preview  # serve the production build locally
```

## Conventions for Claude

- Whole-file writes only when editing existing scaffolded files — Amanda is dyslexic and partial-edit churn is hard to follow.
- No emojis in rendered UI.
- Never re-litigate the locked decisions above without an explicit prompt from Amanda.

## Locked design principles

- **Colours that calm > colours that intensify, especially during security-sensitive flows.** Locked 2026-05-21 after Amanda's feedback on the original purple gradient. Users enrolling passkeys, approving devices, signing in are in a slightly anxious state — the UI should feel reassuring, not intense. Current palette is sky `#0EA5E9` → teal `#2DD4BF` → emerald `#34D399` (background), with teal `#0D9488` for primary actions and sky `#0EA5E9` family for informational panels. Errors stay warm (red/rose). Any future colour decisions defer to this principle.
