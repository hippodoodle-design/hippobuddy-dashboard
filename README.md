# HippoBuddy Dashboard

Front-end SPA for **HippoBuddy v2** — the patient/owner dashboard for HippoFlow's HippoBuddy service. This repo is currently a scaffold (Phase 2a). Real UI lands in Phase 2b.

## What it is

A Vite + React + TypeScript single-page app that will eventually call the [HippoBridge](https://hippobridge.hippoflow.workers.dev) Worker at `/buddy/v2/*` to power passkey enrolment, login, and the dashboard view. Client-side encryption uses a key derived from WebAuthn PRF.

## Stack

- Vite + React + TypeScript
- Tailwind CSS 3
- react-router-dom
- Deployed to Vercel as a static SPA

## Routes

- `/` — Home
- `/enrol` — Passkey enrolment (placeholder)
- `/login` — Passkey login (placeholder)
- `/dashboard` — Authenticated dashboard (placeholder)

All four currently render a "coming soon" card.

## Dev commands

```bash
npm install
npm run dev      # local dev server on http://localhost:5173
npm run build    # production build to ./dist
npm run preview  # preview the built bundle locally
```

## See also

- [`CLAUDE.md`](./CLAUDE.md) — phase plan, locked decisions, Worker endpoints, encryption approach
