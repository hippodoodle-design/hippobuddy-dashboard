import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  base64URLStringToBuffer,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser'
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser'

const WORKER_BASE = 'https://hippobridge.hippoflow.workers.dev'
const RP_ID =
  (import.meta.env.VITE_RP_ID as string | undefined) ??
  'hippobuddy-dashboard.vercel.app'

const PRF_UNSUPPORTED_MESSAGE =
  "Your browser doesn't support the WebAuthn PRF extension yet. HippoBuddy needs this to keep your passwords encrypted on your device. Please try Safari 17+ or Chrome."

type DeviceKind = 'phone' | 'tablet' | 'laptop' | 'desktop' | 'other'

type AuthState = {
  dek: CryptoKey | null
  userId: string | null
  sessionToken: string | null
}

export type AuthResult = { ok: true } | { ok: false; reason: string }

export type BeginRegistrationResponse = {
  options?: PublicKeyCredentialCreationOptionsJSON
  publicKey?: PublicKeyCredentialCreationOptionsJSON
  prfSalt?: string
  userId?: string
  challenge_id?: string
}

type AuthContextValue = AuthState & {
  isAuthenticated: boolean
  enrol: () => Promise<AuthResult>
  login: () => Promise<AuthResult>
  logout: () => void
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  completeEnrolmentFromBegin: (
    begin: BeginRegistrationResponse,
  ) => Promise<AuthResult>
}

const AuthContext = createContext<AuthContextValue | null>(null)

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

function detectPlatformHint(): string | null {
  if (typeof navigator === 'undefined') return null
  return navigator.userAgent.slice(0, 180)
}

function base64urlToBuffer(b64u: string): ArrayBuffer {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? 0 : 4 - (b64.length % 4)
  const bin = atob(b64 + '='.repeat(pad))
  const buffer = new ArrayBuffer(bin.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return buffer
}

function encodeInfo(value: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(value)
  const buffer = new ArrayBuffer(encoded.byteLength)
  new Uint8Array(buffer).set(encoded)
  return buffer
}

async function deriveDek(
  prfOutput: BufferSource,
  hkdfSaltB64u: string,
): Promise<CryptoKey> {
  const saltBuffer = base64urlToBuffer(hkdfSaltB64u)
  const prfKey = await crypto.subtle.importKey(
    'raw',
    prfOutput,
    'HKDF',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt: saltBuffer,
      info: encodeInfo('hippobuddy-dek-v1'),
      hash: 'SHA-256',
    },
    prfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function readPrfFirst(
  response: RegistrationResponseJSON | AuthenticationResponseJSON,
): BufferSource | undefined {
  const ext = response.clientExtensionResults as unknown as
    | { prf?: { results?: { first?: BufferSource } } }
    | undefined
  return ext?.prf?.results?.first
}

function withPrfExtension<
  T extends {
    extensions?: PublicKeyCredentialCreationOptionsJSON['extensions']
  },
>(options: T, prfSalt: string): T {
  const existing = (options.extensions ?? {}) as Record<string, unknown>
  // WebAuthn requires prf.eval.first as a BufferSource at the native API
  // boundary. @simplewebauthn/browser passes extensions through unchanged,
  // so we must decode the base64url salt here even though the JSON type
  // declares it as a string.
  const prfFirstBuffer = base64URLStringToBuffer(prfSalt)
  return {
    ...options,
    extensions: {
      ...existing,
      prf: { eval: { first: prfFirstBuffer } },
    },
  } as unknown as T
}

async function prfPlatformLikelySupported(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const PKC = (window as unknown as { PublicKeyCredential?: typeof PublicKeyCredential })
    .PublicKeyCredential
  if (!PKC) return false
  try {
    if (typeof PKC.isConditionalMediationAvailable === 'function') {
      return await PKC.isConditionalMediationAvailable()
    }
  } catch {
    // ignore
  }
  return true
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${WORKER_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = await res.text()
    } catch {
      // ignore
    }
    throw new Error(
      `${path} failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    )
  }
  return (await res.json()) as T
}

type BeginAuthenticationResponse = {
  options?: PublicKeyCredentialRequestOptionsJSON
  publicKey?: PublicKeyCredentialRequestOptionsJSON
  prfSalt?: string
}

// /authenticate/finish canonically returns { session_token, expires_at, scopes, device_id }.
// /register/finish currently returns no token (only authenticate/finish issues one).
// Camelcase + alternate-name fallbacks kept defensively in case the contract ever shifts.
type FinishResponse = {
  ok?: boolean
  userId?: string
  session_token?: string
  device_id?: string | null
  expires_at?: string
  token?: string
  sessionToken?: string
  accessToken?: string
  bearer?: string
  session?: { token?: string; accessToken?: string }
}

function extractCreationOptions(
  body: BeginRegistrationResponse,
): PublicKeyCredentialCreationOptionsJSON | null {
  if (body.options) return body.options
  if (body.publicKey) return body.publicKey
  const maybe = body as unknown as PublicKeyCredentialCreationOptionsJSON
  if (maybe.challenge && maybe.rp && maybe.user) return maybe
  return null
}

function extractRequestOptions(
  body: BeginAuthenticationResponse,
): PublicKeyCredentialRequestOptionsJSON | null {
  if (body.options) return body.options
  if (body.publicKey) return body.publicKey
  const maybe = body as unknown as PublicKeyCredentialRequestOptionsJSON
  if (maybe.challenge) return maybe
  return null
}

function extractSessionToken(finish: FinishResponse): string | null {
  return (
    finish.session_token ??
    finish.token ??
    finish.sessionToken ??
    finish.accessToken ??
    finish.bearer ??
    finish.session?.token ??
    finish.session?.accessToken ??
    null
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    dek: null,
    userId: null,
    sessionToken: null,
  })

  const completeEnrolmentFromBegin = useCallback<
    (begin: BeginRegistrationResponse) => Promise<AuthResult>
  >(async (begin) => {
    try {
      if (!(await prfPlatformLikelySupported())) {
        return { ok: false, reason: PRF_UNSUPPORTED_MESSAGE }
      }
      const options = extractCreationOptions(begin)
      if (!options) {
        return { ok: false, reason: 'register/begin returned no options' }
      }
      if (!options.rp.id) options.rp.id = RP_ID
      const prfSalt = begin.prfSalt
      if (!prfSalt) {
        return { ok: false, reason: 'register/begin did not return prfSalt' }
      }
      const userIdFromBegin = begin.userId ?? options.user.id

      const optionsWithPrf = withPrfExtension(options, prfSalt)

      let attestation: RegistrationResponseJSON
      try {
        attestation = await startRegistration({ optionsJSON: optionsWithPrf })
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'passkey creation was cancelled'
        return { ok: false, reason: message }
      }

      const prfFirst = readPrfFirst(attestation)
      if (!prfFirst) {
        return { ok: false, reason: PRF_UNSUPPORTED_MESSAGE }
      }

      const dek = await deriveDek(prfFirst, prfSalt)

      const finish = await postJson<FinishResponse>(
        '/buddy/v2/passkeys/register/finish',
        { response: attestation },
      )
      const resolvedUserId = finish.userId ?? userIdFromBegin ?? null
      const sessionToken = extractSessionToken(finish)

      setState({ dek, userId: resolvedUserId, sessionToken })
      return { ok: true }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'unexpected error during enrolment'
      return { ok: false, reason: message }
    }
  }, [])

  const enrol = useCallback<() => Promise<AuthResult>>(async () => {
    try {
      const begin = await postJson<BeginRegistrationResponse>(
        '/buddy/v2/passkeys/register/begin',
        {
          display_name: detectDeviceName(),
          device_kind: detectDeviceKind(),
          platform_hint: detectPlatformHint(),
        },
      )
      return await completeEnrolmentFromBegin(begin)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'unexpected error during enrolment'
      return { ok: false, reason: message }
    }
  }, [completeEnrolmentFromBegin])

  const login = useCallback<() => Promise<AuthResult>>(async () => {
    try {
      if (!(await prfPlatformLikelySupported())) {
        return { ok: false, reason: PRF_UNSUPPORTED_MESSAGE }
      }

      const begin = await postJson<BeginAuthenticationResponse>(
        '/buddy/v2/passkeys/authenticate/begin',
        {},
      )
      const options = extractRequestOptions(begin)
      if (!options) {
        return { ok: false, reason: 'authenticate/begin returned no options' }
      }
      if (!options.rpId) options.rpId = RP_ID
      const prfSalt = begin.prfSalt
      if (!prfSalt) {
        return {
          ok: false,
          reason: 'authenticate/begin did not return prfSalt',
        }
      }

      const optionsWithPrf = withPrfExtension(options, prfSalt)

      let assertion: AuthenticationResponseJSON
      try {
        assertion = await startAuthentication({ optionsJSON: optionsWithPrf })
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'sign-in was cancelled'
        return { ok: false, reason: message }
      }

      const prfFirst = readPrfFirst(assertion)
      if (!prfFirst) {
        return { ok: false, reason: PRF_UNSUPPORTED_MESSAGE }
      }

      const dek = await deriveDek(prfFirst, prfSalt)

      const finish = await postJson<FinishResponse>(
        '/buddy/v2/passkeys/authenticate/finish',
        { response: assertion },
      )
      const resolvedUserId = finish.userId ?? null
      const sessionToken = extractSessionToken(finish)

      setState({ dek, userId: resolvedUserId, sessionToken })
      return { ok: true }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'unexpected error during sign-in'
      return { ok: false, reason: message }
    }
  }, [])

  const logout = useCallback(() => {
    setState({ dek: null, userId: null, sessionToken: null })
  }, [])

  const apiFetch = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers ?? {})
      if (state.sessionToken && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${state.sessionToken}`)
      }
      if (state.userId && !headers.has('X-User-Id')) {
        headers.set('X-User-Id', state.userId)
      }
      if (init.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json')
      }
      return fetch(`${WORKER_BASE}${path}`, {
        ...init,
        headers,
        credentials: init.credentials ?? 'include',
      })
    },
    [state.sessionToken, state.userId],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      isAuthenticated: state.dek !== null,
      enrol,
      login,
      logout,
      apiFetch,
      completeEnrolmentFromBegin,
    }),
    [state, enrol, login, logout, apiFetch, completeEnrolmentFromBegin],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
