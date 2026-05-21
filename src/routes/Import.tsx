import { useCallback, useMemo, useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import mammoth from 'mammoth'
import Papa from 'papaparse'
import { useAuth } from '../auth/AuthContext'
import { encryptString } from '../auth/crypto'

const MAX_BYTES = 50 * 1024
const PARALLEL_UPLOADS = 4

type Step = 'input' | 'parsing' | 'confirm' | 'uploading' | 'done'

type ParsedEntry = {
  site: string
  username: string
  password: string
  url: string
  notes: string
}

type ParseResponse = {
  entries?: ParsedEntry[]
  count?: number
  truncated?: boolean
}

function sanitizeEntry(raw: Partial<ParsedEntry> | undefined): ParsedEntry {
  return {
    site: typeof raw?.site === 'string' ? raw.site : '',
    username: typeof raw?.username === 'string' ? raw.username : '',
    password: typeof raw?.password === 'string' ? raw.password : '',
    url: typeof raw?.url === 'string' ? raw.url : '',
    notes: typeof raw?.notes === 'string' ? raw.notes : '',
  }
}

function byteSize(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

async function readTxt(file: File): Promise<string> {
  return file.text()
}

async function readDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer })
  return result.value
}

async function readCsv(file: File): Promise<string> {
  const text = await file.text()
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true })
  const rows = parsed.data as string[][]
  return rows.map((row) => row.join(' | ')).join('\n')
}

async function readFile(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.docx')) return readDocx(file)
  if (name.endsWith('.csv')) return readCsv(file)
  return readTxt(file)
}

function emptyEntry(): ParsedEntry {
  return { site: '', username: '', password: '', url: '', notes: '' }
}

export default function Import() {
  const { dek, apiFetch, isAuthenticated } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('input')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [entries, setEntries] = useState<ParsedEntry[]>([])
  const [truncated, setTruncated] = useState(false)
  const [uploaded, setUploaded] = useState(0)
  const [uploadFailures, setUploadFailures] = useState<string[]>([])
  const [fileBusy, setFileBusy] = useState(false)

  const bytes = useMemo(() => byteSize(text), [text])
  const over = bytes > MAX_BYTES

  const handleFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      setError(null)
      setFileBusy(true)
      try {
        const extracted = await readFile(file)
        setText((prev) => (prev ? `${prev}\n\n${extracted}` : extracted))
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : `couldn't read ${file.name}`
        setError(`Couldn't read that file: ${message}`)
      } finally {
        setFileBusy(false)
      }
    },
    [],
  )

  const parse = useCallback(async () => {
    if (!text.trim()) {
      setError('Paste some text or upload a file first.')
      return
    }
    if (over) {
      setError(
        `That's ${(bytes / 1024).toFixed(1)} KB — please trim to under 50 KB before parsing.`,
      )
      return
    }
    setError(null)
    setStep('parsing')
    try {
      const res = await apiFetch('/buddy/v2/import/parse', {
        method: 'POST',
        body: JSON.stringify({ text }),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(
          `Parse failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
        )
      }
      const body = (await res.json()) as ParseResponse
      const rawEntries = Array.isArray(body.entries) ? body.entries : []
      const cleaned = rawEntries.map(sanitizeEntry).filter((e) => e.password)
      if (cleaned.length === 0) {
        throw new Error(
          "The AI didn't find any passwords in that text. Try pasting more context, or check the format.",
        )
      }
      setEntries(cleaned)
      setTruncated(Boolean(body.truncated))
      setStep('confirm')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'unexpected parse error'
      setError(message)
      setStep('input')
    }
  }, [apiFetch, bytes, over, text])

  const updateEntry = useCallback(
    (idx: number, field: keyof ParsedEntry, value: string) => {
      setEntries((prev) => {
        const next = prev.slice()
        next[idx] = { ...next[idx], [field]: value }
        return next
      })
    },
    [],
  )

  const deleteEntry = useCallback((idx: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  const addEntry = useCallback(() => {
    setEntries((prev) => [...prev, emptyEntry()])
  }, [])

  const upload = useCallback(async () => {
    if (!dek) {
      setError('Encryption key is gone — please sign in again.')
      return
    }
    const usable = entries.filter((e) => e.password)
    if (usable.length === 0) {
      setError('Nothing to upload — every row needs a password.')
      return
    }
    setError(null)
    setUploaded(0)
    setUploadFailures([])
    setStep('uploading')

    const failures: string[] = []
    let done = 0
    const queue = usable.slice()

    async function worker() {
      while (queue.length > 0) {
        const entry = queue.shift()
        if (!entry) return
        try {
          const { ciphertext, iv } = await encryptString(dek!, entry.password)
          const res = await apiFetch('/buddy/v2/credentials', {
            method: 'POST',
            body: JSON.stringify({
              site: entry.site,
              username: entry.username,
              url: entry.url,
              notes: entry.notes,
              ciphertext,
              iv,
            }),
          })
          if (!res.ok) {
            const detail = await res.text().catch(() => '')
            failures.push(
              `${entry.site || entry.username || 'entry'}: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 80)}` : ''}`,
            )
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'unknown upload error'
          failures.push(
            `${entry.site || entry.username || 'entry'}: ${message}`,
          )
        } finally {
          done += 1
          setUploaded(done)
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(PARALLEL_UPLOADS, usable.length) },
      () => worker(),
    )
    await Promise.all(workers)
    setUploadFailures(failures)
    setStep('done')
  }, [apiFetch, dek, entries])

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-sky-500 via-teal-400 to-emerald-400 p-6">
        <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl px-10 py-12 max-w-md w-full text-center">
          <h1 className="text-xl font-semibold text-slate-900">Sign in first</h1>
          <p className="mt-3 text-sm text-slate-600">
            You need to be signed in to import credentials.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-block rounded-xl bg-slate-900 px-5 py-2 text-sm font-medium text-white"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-sky-500 via-teal-400 to-emerald-400 p-6">
      <div className="mx-auto max-w-4xl bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl px-6 sm:px-10 py-8 sm:py-12">
        <div className="flex items-center justify-between gap-4 mb-6">
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Import credentials
          </h1>
          <Link
            to="/dashboard"
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            Back to dashboard
          </Link>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        {step === 'input' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Paste passwords from anywhere — a Word doc, your notes app, a
              browser export. HippoBuddy will use AI to pull out the entries,
              you check them, then they're encrypted on your device before
              upload.
            </p>
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
                Paste text
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                placeholder="Paste anything that contains logins…"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <div
                className={`mt-1 text-xs ${
                  over ? 'text-rose-600' : 'text-slate-500'
                }`}
              >
                {(bytes / 1024).toFixed(1)} KB / 50 KB
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
                Or upload a file (.txt, .docx, .csv)
              </label>
              <input
                type="file"
                accept=".txt,.docx,.csv,text/plain,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={handleFile}
                disabled={fileBusy}
                className="block w-full text-sm text-slate-700 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800"
              />
              {fileBusy && (
                <div className="mt-1 text-xs text-slate-500">
                  Reading file…
                </div>
              )}
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={parse}
                disabled={!text.trim() || over}
                className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Parse with AI
              </button>
            </div>
          </div>
        )}

        {step === 'parsing' && (
          <div className="py-16 text-center space-y-3">
            <div className="mx-auto h-10 w-10 rounded-full border-4 border-slate-200 border-t-slate-900 animate-spin" />
            <p className="text-sm text-slate-700">
              Reading your text… this usually takes 5–20 seconds.
            </p>
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-4">
            <div className="text-sm text-slate-700">
              Found {entries.length}{' '}
              {entries.length === 1 ? 'entry' : 'entries'}. Edit any field,
              delete what you don't want, then confirm.
              {truncated && (
                <span className="ml-1 text-amber-700">
                  (Capped at 200 — anything beyond that was skipped.)
                </span>
              )}
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Site</th>
                    <th className="px-3 py-2 text-left font-medium">Username</th>
                    <th className="px-3 py-2 text-left font-medium">Password</th>
                    <th className="px-3 py-2 text-left font-medium">URL</th>
                    <th className="px-3 py-2 text-left font-medium">Notes</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {entries.map((entry, idx) => (
                    <tr key={idx} className="align-top">
                      <td className="px-2 py-1.5">
                        <input
                          value={entry.site}
                          onChange={(e) =>
                            updateEntry(idx, 'site', e.target.value)
                          }
                          className="w-32 rounded-md border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={entry.username}
                          onChange={(e) =>
                            updateEntry(idx, 'username', e.target.value)
                          }
                          className="w-40 rounded-md border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={entry.password}
                          onChange={(e) =>
                            updateEntry(idx, 'password', e.target.value)
                          }
                          className="w-40 rounded-md border border-slate-200 px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={entry.url}
                          onChange={(e) =>
                            updateEntry(idx, 'url', e.target.value)
                          }
                          className="w-44 rounded-md border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={entry.notes}
                          onChange={(e) =>
                            updateEntry(idx, 'notes', e.target.value)
                          }
                          className="w-48 rounded-md border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => deleteEntry(idx)}
                          className="rounded-md px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={addEntry}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Add row
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep('input')}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={upload}
                  disabled={entries.length === 0}
                  className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  Confirm and encrypt
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'uploading' && (
          <div className="py-12 text-center space-y-4">
            <p className="text-sm text-slate-700">
              Uploading {uploaded} of {entries.filter((e) => e.password).length}…
            </p>
            <div className="mx-auto h-2 max-w-md rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full bg-slate-900 transition-all"
                style={{
                  width: `${
                    entries.filter((e) => e.password).length === 0
                      ? 0
                      : (uploaded /
                          entries.filter((e) => e.password).length) *
                        100
                  }%`,
                }}
              />
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="py-12 text-center space-y-4">
            {uploadFailures.length === 0 ? (
              <>
                <p className="text-lg font-medium text-slate-900">
                  All saved.
                </p>
                <p className="text-sm text-slate-600">
                  {uploaded} {uploaded === 1 ? 'entry' : 'entries'} encrypted
                  and uploaded.
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-medium text-slate-900">
                  Saved {uploaded - uploadFailures.length} of {uploaded}.
                </p>
                <div className="mx-auto max-w-md text-left rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <div className="font-medium mb-1">
                    {uploadFailures.length}{' '}
                    {uploadFailures.length === 1 ? 'failure' : 'failures'}:
                  </div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {uploadFailures.slice(0, 10).map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                    {uploadFailures.length > 10 && (
                      <li>…and {uploadFailures.length - 10} more</li>
                    )}
                  </ul>
                </div>
              </>
            )}
            <div className="flex justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                View dashboard
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep('input')
                  setText('')
                  setEntries([])
                  setUploaded(0)
                  setUploadFailures([])
                  setTruncated(false)
                }}
                className="rounded-xl border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Import more
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
