// AI-access settings — shared types, sensitivity rules, and the safe
// practice-mode dataset.
//
// HippoBuddy holds Amanda's operational keys. Two separate, plain-English
// permissions can be granted per key:
//   • read    → "Let my AIs read this key"     (maps to ai_accessible)
//   • replace → "Let my AIs replace this key"  (maps to ai_replaceable)
//
// Replace is deliberately a SEPARATE opt-in, default OFF, and stays especially
// guarded on money/hosting keys (Stripe / Supabase / Vercel) — the keys that
// could lock Amanda out of her own accounts if an AI ever swapped them.
//
// This module carries NO secret values — only key NAMES (which are not
// secret) and the on/off permission flags. In preview the page runs on the
// PRACTICE_KEYS below so the screen can be tried safely without touching the
// real vault.

export type AiAccessKey = {
  /** Exact vault credential name, e.g. "STRIPE_API_KEY". Never a secret value. */
  name: string
  /** Friendly label a non-technical person recognises, e.g. "Stripe". */
  label: string
  /** One-line plain description of what the key is for. */
  purpose: string
  /** prod | staging | dev — almost always prod. */
  environment: string
  /** "Let my AIs read this key" — maps to ai_accessible. */
  read: boolean
  /** "Let my AIs replace this key" — maps to ai_replaceable. Default OFF. */
  replace: boolean
  /**
   * Money/hosting key that could lock Amanda out if swapped (Stripe / Supabase
   * / Vercel). Replace stays extra-guarded on these.
   */
  lockoutRisk: boolean
}

// Names (or fragments) that mark a key as money/hosting — a swap here could
// lock Amanda out of billing or hosting, so "replace" stays extra-guarded.
const LOCKOUT_PATTERNS = [/stripe/i, /supabase/i, /service.?role/i, /vercel/i]

export function isLockoutRisk(name: string): boolean {
  return LOCKOUT_PATTERNS.some((re) => re.test(name))
}

// Safe practice dataset for the preview. These are real, recognisable key
// NAMES from Amanda's world (no values) so the screen reads truthfully, but
// every toggle here is local-only and touches nothing real.
export const PRACTICE_KEYS: AiAccessKey[] = [
  {
    name: 'STRIPE_API_KEY',
    label: 'Stripe',
    purpose: 'Takes card payments from your customers',
    environment: 'prod',
    read: false,
    replace: false,
    lockoutRisk: true,
  },
  {
    name: 'SUPABASE_BONNIE_BOTHY_SERVICE_ROLE',
    label: 'Supabase — Bonnie Bothy Cloud',
    purpose: 'Your main database and file storage',
    environment: 'prod',
    read: false,
    replace: false,
    lockoutRisk: true,
  },
  {
    name: 'VERCEL_TOKEN',
    label: 'Vercel',
    purpose: 'Publishes your websites and apps online',
    environment: 'prod',
    read: false,
    replace: false,
    lockoutRisk: true,
  },
  {
    name: 'GEMINI_API_KEY',
    label: 'Google Gemini',
    purpose: 'An AI brain your helpers can use',
    environment: 'prod',
    read: true,
    replace: false,
    lockoutRisk: false,
  },
  {
    name: 'PERPLEXITY_API_KEY',
    label: 'Perplexity',
    purpose: 'AI web research',
    environment: 'prod',
    read: true,
    replace: false,
    lockoutRisk: false,
  },
  {
    name: 'ELEVENLABS_API_KEY',
    label: 'ElevenLabs',
    purpose: 'Turns text into a spoken voice',
    environment: 'prod',
    read: false,
    replace: false,
    lockoutRisk: false,
  },
  {
    name: 'OPENROUTER_API_KEY',
    label: 'OpenRouter',
    purpose: 'A gateway to several AI models',
    environment: 'prod',
    read: false,
    replace: false,
    lockoutRisk: false,
  },
  {
    name: 'GITHUB_TOKEN_HIPPODOODLE',
    label: 'GitHub token',
    purpose: 'Lets your helpers save and ship code',
    environment: 'prod',
    read: true,
    replace: false,
    lockoutRisk: false,
  },
]

// ---- Live-mode wire format -------------------------------------------------
// What the worker's GET /buddy/v2/service-credentials returns per row (the
// fields we care about). Extra fields are ignored.
export type ServiceCredentialRow = {
  name?: string
  environment?: string
  description?: string | null
  ai_accessible?: boolean
  ai_replaceable?: boolean
}

export function rowToKey(row: ServiceCredentialRow, idx: number): AiAccessKey {
  const name = typeof row.name === 'string' && row.name ? row.name : `key-${idx}`
  return {
    name,
    label: prettifyName(name),
    purpose:
      typeof row.description === 'string' && row.description
        ? row.description
        : '',
    environment:
      typeof row.environment === 'string' && row.environment
        ? row.environment
        : 'prod',
    read: row.ai_accessible === true,
    replace: row.ai_replaceable === true,
    lockoutRisk: isLockoutRisk(name),
  }
}

// Turn STRIPE_API_KEY → "Stripe", SUPABASE_BONNIE_BOTHY_SERVICE_ROLE →
// "Supabase Bonnie Bothy" so an unfamiliar key still reads as words.
function prettifyName(name: string): string {
  const trimmed = name
    .replace(/_?(api[_-]?key|token|service[_-]?role|secret)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
  const base = trimmed.length > 0 ? trimmed : name
  return base
    .split(' ')
    .map((w) => (w.length <= 2 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
}
