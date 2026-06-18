import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { decryptString } from '../auth/crypto'

const REVEAL_MS = 8000

type Credential = {
  id: string
  site: string
  username: string
  url: string
  notes: string
  ciphertext: string
  iv: string
}

type RawCredential = Partial<Credential> & {
  _id?: string
  uuid?: string
  cred_id?: string
}

type ListResponse = {
  credentials?: RawCredential[]
  items?: RawCredential[]
  data?: RawCredential[]
}

function normalise(raw: RawCredential, fallbackIdx: number): Credential | null {
  const ciphertext = raw.ciphertext
  const iv = raw.iv
  if (typeof ciphertext !== 'string' || typeof iv !== 'string') return null
  const id =
    raw.id ?? raw._id ?? raw.uuid ?? raw.cred_id ?? `cred-${fallbackIdx}`
  return {
    id: String(id),
    site: typeof raw.site === 'string' ? raw.site : '',
    username: typeof raw.username === 'string' ? raw.username : '',
    url: typeof raw.url === 'string' ? raw.url : '',
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    ciphertext,
    iv,
  }
}

function extractList(body: ListResponse | RawCredential[]): RawCredential[] {
  if (Array.isArray(body)) return body
  if (Array.isArray(body.credentials)) return body.credentials
  if (Array.isArray(body.items)) return body.items
  if (Array.isArray(body.data)) return body.data
  return []
}

export default function Dashboard() {
  const { logout, apiFetch, dek } = useAuth()
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/buddy/v2/credentials')
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(
          `Couldn't load credentials (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
        )
      }
      const body = (await res.json()) as ListResponse | RawCredential[]
      const list = extractList(body)
      const cleaned = list
        .map((raw, idx) => normalise(raw, idx))
        .filter((c): c is Credential => c !== null)
      cleaned.sort((a, b) =>
        (a.site || a.username || '').localeCompare(
          b.site || b.username || '',
          undefined,
          { sensitivity: 'base' },
        ),
      )
      setCredentials(cleaned)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'unexpected error loading credentials'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void load()
  }, [load])

  const reveal = useCallback(
    async (cred: Credential) => {
      if (!dek) {
        setError('Encryption key is gone — please sign in again.')
        return
      }
      try {
        const plaintext = await decryptString(dek, cred.ciphertext, cred.iv)
        setRevealed((prev) => ({ ...prev, [cred.id]: plaintext }))
        window.setTimeout(() => {
          setRevealed((prev) => {
            if (!(cred.id in prev)) return prev
            const next = { ...prev }
            delete next[cred.id]
            return next
          })
        }, REVEAL_MS)
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'decrypt failed'
        setError(`Couldn't decrypt: ${message}`)
      }
    },
    [dek],
  )

  const hide = useCallback((id: string) => {
    setRevealed((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const copy = useCallback(async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(id)
      window.setTimeout(() => {
        setCopied((c) => (c === id ? null : c))
      }, 1500)
    } catch {
      setError("Couldn't copy to clipboard.")
    }
  }, [])

  const remove = useCallback(
    async (cred: Credential) => {
      if (!window.confirm(`Delete ${cred.site || cred.username || 'this entry'}?`)) return
      setDeleting(cred.id)
      try {
        const res = await apiFetch(
          `/buddy/v2/credentials/${encodeURIComponent(cred.id)}`,
          { method: 'DELETE' },
        )
        if (!res.ok && res.status !== 404) {
          const detail = await res.text().catch(() => '')
          throw new Error(
            `Delete failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
          )
        }
        setCredentials((prev) => prev.filter((c) => c.id !== cred.id))
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'unexpected error'
        setError(message)
      } finally {
        setDeleting(null)
      }
    },
    [apiFetch],
  )

  const grouped = useMemo(() => {
    const groups = new Map<string, Credential[]>()
    for (const c of credentials) {
      const key = c.site || c.username || 'Other'
      const bucket = groups.get(key) ?? []
      bucket.push(c)
      groups.set(key, bucket)
    }
    return Array.from(groups.entries()).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    )
  }, [credentials])

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-sky-500 via-teal-400 to-emerald-400 p-6">
      <div className="mx-auto max-w-3xl bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl px-6 sm:px-10 py-8 sm:py-12">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
              Your credentials
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              Encryption key in memory. Passwords decrypt only when you tap Reveal.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/import"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Import more
            </Link>
            <Link
              to="/ai-access"
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              AI access
            </Link>
            <Link
              to="/add-device?mode=approve"
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Add another device
            </Link>
            <button
              type="button"
              onClick={logout}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex items-start justify-between gap-3">
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

        {!loading && credentials.length === 0 && !error && (
          <div className="py-16 text-center space-y-4">
            <div className="mx-auto h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-2xl">
              ·
            </div>
            <p className="text-sm text-slate-700">No credentials yet.</p>
            <Link
              to="/import"
              className="inline-block rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              Import from anywhere
            </Link>
          </div>
        )}

        {!loading && credentials.length > 0 && (
          <div className="space-y-6">
            {grouped.map(([site, items]) => (
              <section key={site}>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                  {site}
                </h2>
                <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                  {items.map((cred) => {
                    const revealedValue = revealed[cred.id]
                    return (
                      <li key={cred.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0 flex items-center gap-3">
                            <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500">
                              <span aria-hidden className="text-base">
                                ·
                              </span>
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-900 truncate">
                                {cred.site || '(no site)'}
                              </div>
                              <div className="text-xs text-slate-500 truncate">
                                {cred.username || '(no username)'}
                                {cred.url ? ` · ${cred.url}` : ''}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {revealedValue === undefined ? (
                              <button
                                type="button"
                                onClick={() => reveal(cred)}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                Reveal
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => hide(cred.id)}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                Hide
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => remove(cred)}
                              disabled={deleting === cred.id}
                              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                            >
                              {deleting === cred.id ? 'Deleting…' : 'Delete'}
                            </button>
                          </div>
                        </div>
                        {revealedValue !== undefined && (
                          <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 flex items-center justify-between gap-3">
                            <code className="text-sm font-mono text-slate-900 truncate">
                              {revealedValue}
                            </code>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => copy(cred.id, revealedValue)}
                                className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800"
                              >
                                {copied === cred.id ? 'Copied' : 'Copy'}
                              </button>
                              <span className="text-[10px] uppercase tracking-wide text-slate-400">
                                Auto-hide 8s
                              </span>
                            </div>
                          </div>
                        )}
                        {cred.notes && (
                          <div className="mt-2 text-xs text-slate-500 whitespace-pre-wrap">
                            {cred.notes}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
