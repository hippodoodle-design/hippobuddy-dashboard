import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  PRACTICE_KEYS,
  rowToKey,
  type AiAccessKey,
  type ServiceCredentialRow,
} from '../ai-access/aiAccess'

// Live mode talks to the real vault over the worker REST API. Off by default,
// so the deployed preview is always the safe practice screen. Flip
// VITE_AI_ACCESS_LIVE=true (and wire the service:* scopes) on go-live.
const LIVE = (import.meta.env.VITE_AI_ACCESS_LIVE as string | undefined) === 'true'

type Perm = 'read' | 'replace'

function Toggle({
  on,
  onClick,
  disabled,
  label,
  tone = 'normal',
}: {
  on: boolean
  onClick: () => void
  disabled?: boolean
  label: string
  tone?: 'normal' | 'caution'
}) {
  const onColor = tone === 'caution' ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={[
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors',
        on ? onColor : 'bg-slate-300',
        disabled ? 'opacity-50' : 'cursor-pointer',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-6' : 'translate-x-1',
        ].join(' ')}
      />
    </button>
  )
}

export default function AiAccess() {
  const { logout, apiFetch } = useAuth()
  const [keys, setKeys] = useState<AiAccessKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingName, setSavingName] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  // Pending confirm for turning ON replace on a lock-out-risk key.
  const [confirmReplace, setConfirmReplace] = useState<AiAccessKey | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    if (!LIVE) {
      // Practice mode — local copy, nothing real touched.
      setKeys(PRACTICE_KEYS.map((k) => ({ ...k })))
      setLoading(false)
      return
    }
    try {
      const res = await apiFetch('/buddy/v2/service-credentials')
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(
          `Couldn't load your keys (HTTP ${res.status})${detail ? `: ${detail.slice(0, 160)}` : ''}`,
        )
      }
      const body = (await res.json()) as { credentials?: ServiceCredentialRow[] }
      const rows = Array.isArray(body.credentials) ? body.credentials : []
      const mapped = rows.map((r, i) => rowToKey(r, i))
      mapped.sort((a, b) => {
        if (a.lockoutRisk !== b.lockoutRisk) return a.lockoutRisk ? -1 : 1
        return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
      })
      setKeys(mapped)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unexpected error loading keys')
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void load()
  }, [load])

  // Persist one permission change. In practice mode this only updates local
  // state; in live mode it PATCHes the vault (audited server-side).
  const persist = useCallback(
    async (key: AiAccessKey, perm: Perm, next: boolean) => {
      const apply = () =>
        setKeys((prev) =>
          prev.map((k) => (k.name === key.name ? { ...k, [perm]: next } : k)),
        )
      if (!LIVE) {
        apply()
        flash(perm === 'read' ? 'Saved (practice)' : 'Saved (practice)')
        return
      }
      setSavingName(key.name)
      try {
        const field = perm === 'read' ? 'ai_accessible' : 'ai_replaceable'
        const res = await apiFetch(
          `/buddy/v2/service-credentials/by-name/${encodeURIComponent(key.name)}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ [field]: next, environment: key.environment }),
          },
        )
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          throw new Error(
            `Couldn't save (HTTP ${res.status})${detail ? `: ${detail.slice(0, 160)}` : ''}`,
          )
        }
        apply()
        flash('Saved')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'save failed')
      } finally {
        setSavingName(null)
      }
    },
    [apiFetch, flash],
  )

  const onToggleRead = useCallback(
    (key: AiAccessKey) => void persist(key, 'read', !key.read),
    [persist],
  )

  const onToggleReplace = useCallback(
    (key: AiAccessKey) => {
      if (!key.replace && key.lockoutRisk) {
        // Turning ON replace for a money/hosting key — make her confirm.
        setConfirmReplace(key)
        return
      }
      void persist(key, 'replace', !key.replace)
    },
    [persist],
  )

  const turnOnAllRead = useCallback(async () => {
    setConfirmAll(false)
    if (!LIVE) {
      setKeys((prev) => prev.map((k) => ({ ...k, read: true })))
      flash('All keys readable (practice)')
      return
    }
    setSavingName('*')
    try {
      const res = await apiFetch('/buddy/v2/service-credentials/ai-access-all', {
        method: 'POST',
        body: JSON.stringify({ ai_accessible: true }),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(
          `Couldn't turn on for all (HTTP ${res.status})${detail ? `: ${detail.slice(0, 160)}` : ''}`,
        )
      }
      setKeys((prev) => prev.map((k) => ({ ...k, read: true })))
      flash('Reading turned on for all keys')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'turn-on-for-all failed')
    } finally {
      setSavingName(null)
    }
  }, [apiFetch, flash])

  const allReadable = useMemo(
    () => keys.length > 0 && keys.every((k) => k.read),
    [keys],
  )

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-sky-500 via-teal-400 to-emerald-400 p-4 sm:p-6">
      <div className="mx-auto max-w-2xl bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl px-5 sm:px-9 py-7 sm:py-10">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
              Let your AIs use your keys
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Decide, key by key, what your AI helpers are allowed to do. You can
              change any switch any time.
            </p>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <Link
              to="/dashboard"
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 text-center"
            >
              Back
            </Link>
            <button
              type="button"
              onClick={logout}
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Practice-mode banner */}
        {!LIVE && (
          <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            <span className="font-semibold">Practice screen.</span> This is a safe
            place to see how it works. Flicking switches here does{' '}
            <span className="font-semibold">not</span> touch your real keys yet —
            nothing is saved to the vault. When you're happy with how it looks,
            tell Claude “take it live”.
          </div>
        )}

        {/* What the two switches mean */}
        <div className="mt-4 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
          <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
            <span className="font-semibold text-emerald-800">Read</span> — your AI
            helpers may look at the key to do a job (e.g. send an email, post your
            site).
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
            <span className="font-semibold text-amber-800">Replace</span> — your AI
            helpers may swap the key for a new one. Off by default. Stays off on
            money &amp; hosting keys unless you turn it on.
          </div>
        </div>

        {/* Turn on reading for all */}
        <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-sm text-slate-700">
            <div className="font-medium text-slate-900">Turn on reading for all</div>
            <div className="text-xs text-slate-500">
              One tap lets your AIs read every key. (Replace stays off.)
            </div>
          </div>
          <button
            type="button"
            disabled={allReadable || savingName === '*'}
            onClick={() => setConfirmAll(true)}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            {allReadable ? 'All on' : savingName === '*' ? 'Turning on…' : 'Turn on for all'}
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex items-start justify-between gap-3">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-rose-700 hover:text-rose-900 text-xs font-medium"
            >
              Dismiss
            </button>
          </div>
        )}

        {loading && (
          <div className="py-16 text-center">
            <div className="mx-auto h-8 w-8 rounded-full border-4 border-slate-200 border-t-slate-900 animate-spin" />
            <p className="mt-3 text-sm text-slate-600">Loading…</p>
          </div>
        )}

        {/* Key list */}
        {!loading && (
          <ul className="mt-5 space-y-3">
            {keys.map((key) => {
              const saving = savingName === key.name
              return (
                <li
                  key={key.name}
                  className={[
                    'rounded-xl border px-4 py-3',
                    key.lockoutRisk
                      ? 'border-amber-200 bg-amber-50/40'
                      : 'border-slate-200 bg-white',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 truncate">
                          {key.label}
                        </span>
                        {key.lockoutRisk && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                            Can lock you out
                          </span>
                        )}
                      </div>
                      {key.purpose && (
                        <div className="text-xs text-slate-500 truncate">
                          {key.purpose}
                        </div>
                      )}
                    </div>
                    {saving && (
                      <span className="text-[10px] uppercase tracking-wide text-slate-400 shrink-0">
                        Saving…
                      </span>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="flex items-center justify-between gap-2 rounded-lg bg-white border border-slate-200 px-3 py-2">
                      <span className="text-sm text-slate-700">
                        Let my AIs <span className="font-medium">read</span> this key
                      </span>
                      <Toggle
                        on={key.read}
                        disabled={saving}
                        onClick={() => onToggleRead(key)}
                        label={`Let my AIs read ${key.label}`}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 rounded-lg bg-white border border-slate-200 px-3 py-2">
                      <span className="text-sm text-slate-700">
                        Let my AIs <span className="font-medium">replace</span> this key
                      </span>
                      <Toggle
                        on={key.replace}
                        disabled={saving}
                        tone="caution"
                        onClick={() => onToggleReplace(key)}
                        label={`Let my AIs replace ${key.label}`}
                      />
                    </label>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <p className="mt-6 text-center text-[11px] text-slate-400">
          Every read, save and replace is written to your audit log.
        </p>
      </div>

      {/* Confirm: turn on REPLACE for a money/hosting key */}
      {confirmReplace && (
        <Modal onClose={() => setConfirmReplace(null)}>
          <h2 className="text-lg font-semibold text-slate-900">
            Let AIs replace your {confirmReplace.label} key?
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            This is a <span className="font-semibold">money / hosting</span> key. If
            an AI replaces it, it could lock you out of {confirmReplace.label}.
            Reading is usually all your helpers need. Only turn this on if you're
            sure.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmReplace(null)}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              No, keep it off
            </button>
            <button
              type="button"
              onClick={() => {
                const k = confirmReplace
                setConfirmReplace(null)
                void persist(k, 'replace', true)
              }}
              className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
            >
              Yes, allow replace
            </button>
          </div>
        </Modal>
      )}

      {/* Confirm: turn on reading for all */}
      {confirmAll && (
        <Modal onClose={() => setConfirmAll(false)}>
          <h2 className="text-lg font-semibold text-slate-900">
            Let your AIs read every key?
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            This turns on <span className="font-semibold">reading</span> for all your
            keys at once. It does <span className="font-semibold">not</span> let
            anything replace a key — replacing stays off until you turn it on per
            key.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmAll(false)}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void turnOnAllRead()}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Yes, turn on reading for all
            </button>
          </div>
        </Modal>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed inset-x-0 bottom-6 flex justify-center px-4">
          <div className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
            {toast}
          </div>
        </div>
      )}
    </div>
  )
}

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
