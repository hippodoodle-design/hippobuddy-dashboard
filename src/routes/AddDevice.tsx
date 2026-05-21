import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import QRCode from 'react-qr-code'
import { useAuth, type BeginRegistrationResponse } from '../auth/AuthContext'

const WORKER_BASE = 'https://hippobridge.hippoflow.workers.dev'
const APPROVAL_TTL_FALLBACK_SECONDS = 10 * 60
const POLL_INTERVAL_MS = 3000

type DeviceKind = 'phone' | 'tablet' | 'laptop' | 'desktop' | 'other'

const DEVICE_KIND_LABELS: Record<DeviceKind, string> = {
  phone: 'Phone',
  tablet: 'Tablet',
  laptop: 'Laptop',
  desktop: 'Desktop',
  other: 'Other',
}

type CreateApprovalResponse = {
  approval_id?: string
  approval_code?: string
  expires_at?: string
  pending_device_name?: string
  pending_device_kind?: string
}

function detectDeviceKind(): DeviceKind {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent
  if (/iPad/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
    return 'tablet'
  }
  if (/iPhone|iPod|Android.*Mobile|Mobile.*Firefox/i.test(ua)) {
    return 'phone'
  }
  if (/Macintosh|Mac OS X|Linux/i.test(ua)) return 'laptop'
  if (/Windows NT/i.test(ua)) return 'laptop'
  return 'other'
}

function detectDeviceName(): string {
  if (typeof navigator === 'undefined') return 'New device'
  const ua = navigator.userAgent
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua) && /Mobile/i.test(ua)) return 'Android phone'
  if (/Android/i.test(ua)) return 'Android tablet'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac'
  if (/Windows NT/i.test(ua)) return 'Windows PC'
  if (/Linux/i.test(ua)) return 'Linux machine'
  return 'New device'
}

function platformHint(): string | null {
  if (typeof navigator === 'undefined') return null
  return navigator.userAgent.slice(0, 180)
}

function looksLikePending(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('approval_code required') ||
    lower.includes('approval_code not approved') ||
    lower.includes('not approved') ||
    lower.includes('forbidden')
  )
}

function looksTerminal(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('expired') ||
    lower.includes('not_found') ||
    lower.includes('not found') ||
    lower.includes('rejected')
  )
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00'
  const totalSeconds = Math.floor(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function isValidCodeShape(code: string): boolean {
  return /^[a-z]+-[a-z]+-[a-z]+-[a-z]+$/i.test(code.trim())
}

// =========================================================================
// Sub-flow A: Request enrolment (new device asks to be admitted)
// =========================================================================

type RequestStep =
  | { kind: 'form' }
  | {
      kind: 'waiting'
      code: string
      expiresAt: number
      displayName: string
      deviceKind: DeviceKind
    }
  | { kind: 'finishing' }
  | { kind: 'done' }
  | { kind: 'error'; message: string; canRetry: boolean }

function RequestSubflow() {
  const navigate = useNavigate()
  const { completeEnrolmentFromBegin } = useAuth()

  const [displayName, setDisplayName] = useState(() => detectDeviceName())
  const [deviceKind, setDeviceKind] = useState<DeviceKind>(() =>
    detectDeviceKind(),
  )
  const [step, setStep] = useState<RequestStep>({ kind: 'form' })
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const cancelledRef = useRef(false)

  // Keep "now" ticking for the countdown.
  useEffect(() => {
    if (step.kind !== 'waiting') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [step.kind])

  useEffect(() => () => {
    cancelledRef.current = true
  }, [])

  const beginRequest = useCallback(async () => {
    cancelledRef.current = false
    const name = displayName.trim() || detectDeviceName()

    try {
      const res = await fetch(`${WORKER_BASE}/buddy/v2/device-approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: name,
          device_kind: deviceKind,
          platform_hint: platformHint(),
        }),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(
          `Couldn't start enrolment (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
        )
      }
      const body = (await res.json()) as CreateApprovalResponse
      const code = body.approval_code
      if (!code) throw new Error('Worker did not return an approval code.')
      const expiresAt = body.expires_at
        ? new Date(body.expires_at).getTime()
        : Date.now() + APPROVAL_TTL_FALLBACK_SECONDS * 1000

      if (cancelledRef.current) return
      setStep({
        kind: 'waiting',
        code,
        expiresAt,
        displayName: name,
        deviceKind,
      })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'unexpected error'
      setStep({ kind: 'error', message, canRetry: true })
    }
  }, [deviceKind, displayName])

  // While in "waiting", poll register/begin every POLL_INTERVAL_MS.
  // The worker uses register/begin as the gate: it returns 200 with options
  // only when the approval row has been approved on a trusted device.
  useEffect(() => {
    if (step.kind !== 'waiting') return
    let stopped = false
    let timeoutId: number | undefined

    const poll = async () => {
      if (stopped || cancelledRef.current) return
      if (Date.now() > step.expiresAt) {
        setStep({
          kind: 'error',
          message: 'Approval code expired. Start again.',
          canRetry: true,
        })
        return
      }
      try {
        const res = await fetch(
          `${WORKER_BASE}/buddy/v2/passkeys/register/begin`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              approval_code: step.code,
              display_name: step.displayName,
              device_kind: step.deviceKind,
              platform_hint: platformHint(),
            }),
          },
        )
        if (res.ok) {
          const begin = (await res.json()) as BeginRegistrationResponse
          stopped = true
          if (cancelledRef.current) return
          setStep({ kind: 'finishing' })
          const result = await completeEnrolmentFromBegin(begin)
          if (cancelledRef.current) return
          if (result.ok) {
            setStep({ kind: 'done' })
            window.setTimeout(() => navigate('/dashboard', { replace: true }), 800)
          } else {
            setStep({
              kind: 'error',
              message: `Passkey ceremony failed: ${result.reason}`,
              canRetry: true,
            })
          }
          return
        }
        const detail = await res.text().catch(() => '')
        if (looksTerminal(detail)) {
          stopped = true
          setStep({
            kind: 'error',
            message: detail.includes('expired')
              ? 'Approval code expired. Start again.'
              : `Approval rejected: ${detail.slice(0, 200)}`,
            canRetry: true,
          })
          return
        }
        if (res.status === 403 && looksLikePending(detail)) {
          // Still waiting — schedule next poll.
        } else if (res.status >= 500) {
          // Transient — keep polling.
        } else {
          // Unexpected client error — surface it.
          stopped = true
          setStep({
            kind: 'error',
            message: `Couldn't check approval (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
            canRetry: true,
          })
          return
        }
      } catch (err) {
        // Network blip — keep trying until the code expires.
        void err
      }
      if (!stopped && !cancelledRef.current) {
        timeoutId = window.setTimeout(poll, POLL_INTERVAL_MS)
      }
    }

    // First check immediately, then interval.
    timeoutId = window.setTimeout(poll, POLL_INTERVAL_MS)

    return () => {
      stopped = true
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [step, completeEnrolmentFromBegin, navigate])

  const handleCopy = useCallback(async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore — fall back to manual copy
    }
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    setStep({ kind: 'form' })
  }, [])

  const approveUrl = useMemo(() => {
    if (step.kind !== 'waiting') return ''
    if (typeof window === 'undefined') return ''
    const origin = window.location.origin
    return `${origin}/add-device?mode=approve&code=${encodeURIComponent(step.code.toLowerCase())}`
  }, [step])

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-sky-500 via-teal-400 to-emerald-400 p-6">
      <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl px-8 sm:px-10 py-10 sm:py-12 max-w-lg w-full">
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight text-center">
          Enrol this device
        </h1>
        <p className="mt-3 text-sm text-slate-600 text-center">
          Add this device to your HippoBuddy account by approving it from a
          device you've already enrolled.
        </p>

        {step.kind === 'form' && (
          <div className="mt-8 space-y-4">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
                Name this device
              </label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Amanda's iPhone"
                maxLength={120}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
                What kind of device?
              </label>
              <select
                value={deviceKind}
                onChange={(e) => setDeviceKind(e.target.value as DeviceKind)}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {(Object.keys(DEVICE_KIND_LABELS) as DeviceKind[]).map((k) => (
                  <option key={k} value={k}>
                    {DEVICE_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={beginRequest}
              disabled={!displayName.trim()}
              className="w-full rounded-xl bg-teal-600 px-6 py-3 text-base font-semibold text-white shadow-md transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Get an approval code
            </button>
            <div className="text-center text-sm text-slate-600">
              Already enrolled here?{' '}
              <Link
                to="/login"
                className="font-medium text-teal-700 hover:underline"
              >
                Sign in
              </Link>
            </div>
          </div>
        )}

        {step.kind === 'waiting' && (
          <WaitingPanel
            code={step.code}
            approveUrl={approveUrl}
            now={now}
            expiresAt={step.expiresAt}
            copied={copied}
            onCopy={() => handleCopy(step.code)}
            onCancel={cancel}
          />
        )}

        {step.kind === 'finishing' && (
          <div className="mt-10 text-center space-y-3">
            <div className="mx-auto h-10 w-10 rounded-full border-4 border-slate-200 border-t-teal-600 animate-spin" />
            <p className="text-sm text-slate-700">
              Approval received. Creating your passkey on this device…
            </p>
            <p className="text-xs text-slate-500">
              Your browser may prompt you to confirm with Face ID, Touch ID, or
              your device PIN.
            </p>
          </div>
        )}

        {step.kind === 'done' && (
          <div className="mt-10 text-center space-y-3">
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              All set. Sending you to your dashboard…
            </div>
          </div>
        )}

        {step.kind === 'error' && (
          <div className="mt-8 space-y-4">
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {step.message}
            </div>
            {step.canRetry && (
              <button
                type="button"
                onClick={() => setStep({ kind: 'form' })}
                className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Try again
              </button>
            )}
            <div className="text-center">
              <Link
                to="/login"
                className="text-sm text-slate-600 hover:text-slate-900"
              >
                Back to sign in
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function WaitingPanel({
  code,
  approveUrl,
  now,
  expiresAt,
  copied,
  onCopy,
  onCancel,
}: {
  code: string
  approveUrl: string
  now: number
  expiresAt: number
  copied: boolean
  onCopy: () => void
  onCancel: () => void
}) {
  const remaining = expiresAt - now
  const expired = remaining <= 0
  const lower = code.toLowerCase()

  return (
    <div className="mt-8 space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-center">
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
          Approval code
        </div>
        <div
          className="font-mono text-2xl sm:text-3xl font-semibold text-slate-900 break-all"
          aria-live="polite"
        >
          {lower}
        </div>
        <div className="mt-3 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onCopy}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <span
            className={`text-xs ${expired ? 'text-rose-600' : 'text-slate-500'}`}
          >
            {expired ? 'Expired' : `Expires in ${formatCountdown(remaining)}`}
          </span>
        </div>
      </div>

      <div className="flex flex-col items-center">
        <div className="rounded-xl bg-white p-3 border border-slate-200">
          {approveUrl ? (
            <QRCode value={approveUrl} size={176} />
          ) : (
            <div className="h-44 w-44 bg-slate-100" />
          )}
        </div>
        <p className="mt-3 max-w-sm text-center text-xs text-slate-600">
          On a device you've already enrolled, scan this QR — or open
          <span className="font-mono"> /add-device?mode=approve</span> and type
          the code above.
        </p>
      </div>

      <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        Waiting for approval from your other device… this page will continue
        automatically once you've approved it.
      </div>

      <div className="text-center">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// =========================================================================
// Sub-flow B: Approve a device (trusted device confirms a new one)
// =========================================================================

type ApproveStep =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

function ApproveSubflow() {
  const { isAuthenticated, apiFetch } = useAuth()
  const [searchParams] = useSearchParams()
  const initialCode = (searchParams.get('code') ?? '').trim().toLowerCase()

  const [code, setCode] = useState(initialCode)
  const [step, setStep] = useState<ApproveStep>({ kind: 'idle' })

  const submit = useCallback(async () => {
    const trimmed = code.trim()
    if (!isValidCodeShape(trimmed)) {
      setStep({
        kind: 'error',
        message: 'Codes look like four words joined by hyphens.',
      })
      return
    }
    setStep({ kind: 'working' })
    try {
      const res = await apiFetch(
        `/buddy/v2/device-approvals/${encodeURIComponent(trimmed.toUpperCase())}/approve`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        let friendly: string
        if (res.status === 404) {
          friendly = "We couldn't find that code. Double-check the spelling."
        } else if (res.status === 403) {
          friendly = 'That code has expired. Ask the new device to request a fresh one.'
        } else if (res.status === 409) {
          friendly = 'That code has already been used.'
        } else if (res.status === 401) {
          friendly = 'Your session expired. Sign in again and retry.'
        } else {
          friendly = `Approval failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`
        }
        setStep({ kind: 'error', message: friendly })
        return
      }
      setStep({ kind: 'done' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unexpected error'
      setStep({ kind: 'error', message })
    }
  }, [apiFetch, code])

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-sky-500 via-teal-400 to-emerald-400 p-6">
        <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl px-10 py-12 max-w-md w-full text-center">
          <h1 className="text-xl font-semibold text-slate-900">
            Sign in first
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            To approve a new device you need to be signed in here. Sign in,
            then come back and re-enter the code{initialCode ? '.' : ' from the other device.'}
          </p>
          {initialCode && (
            <p className="mt-3 font-mono text-sm text-slate-900">
              {initialCode}
            </p>
          )}
          <Link
            to="/login"
            className="mt-6 inline-block rounded-xl bg-slate-900 px-5 py-2 text-sm font-medium text-white"
          >
            Sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-sky-500 via-teal-400 to-emerald-400 p-6">
      <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl px-8 sm:px-10 py-10 sm:py-12 max-w-md w-full">
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight text-center">
          Approve a new device
        </h1>
        <p className="mt-3 text-sm text-slate-600 text-center">
          Enter the four-word code shown on the device you want to add.
        </p>

        <div className="mt-8 space-y-4">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
              Approval code
            </label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toLowerCase())}
              placeholder="word-word-word-word"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base font-mono focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={step.kind === 'working' || step.kind === 'done'}
            className="w-full rounded-xl bg-teal-600 px-6 py-3 text-base font-semibold text-white shadow-md transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {step.kind === 'working' ? 'Approving…' : 'Approve this device'}
          </button>

          {step.kind === 'done' && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              Approved. The new device should finish enrolling itself within a
              few seconds.
            </div>
          )}

          {step.kind === 'error' && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {step.message}
            </div>
          )}

          <div className="text-center">
            <Link
              to="/dashboard"
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

// =========================================================================
// Route entry
// =========================================================================

export default function AddDevice() {
  const [searchParams] = useSearchParams()
  const mode = searchParams.get('mode') === 'approve' ? 'approve' : 'request'
  return mode === 'approve' ? <ApproveSubflow /> : <RequestSubflow />
}
