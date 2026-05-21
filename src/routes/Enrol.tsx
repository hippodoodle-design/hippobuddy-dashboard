import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

type EnrolState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

export default function Enrol() {
  const { enrol } = useAuth()
  const [state, setState] = useState<EnrolState>({ kind: 'idle' })

  async function handleEnrol() {
    setState({ kind: 'working' })
    const result = await enrol()
    if (result.ok) {
      setState({ kind: 'done' })
    } else {
      setState({ kind: 'error', message: result.reason })
    }
  }

  const isWorking = state.kind === 'working'
  const isDone = state.kind === 'done'

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-sky-500 via-teal-400 to-emerald-400 p-6">
      <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl px-10 py-12 max-w-md w-full">
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight text-center">
          Enrol this device
        </h1>
        <p className="mt-3 text-sm text-slate-600 text-center">
          Create a passkey on this device. HippoBuddy uses it to encrypt your data
          locally — no password, ever.
        </p>

        {!isDone && (
          <button
            type="button"
            onClick={handleEnrol}
            disabled={isWorking}
            className="mt-8 w-full rounded-xl bg-teal-600 px-6 py-3 text-base font-semibold text-white shadow-md transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isWorking ? 'Creating passkey…' : 'Enrol this device'}
          </button>
        )}

        {state.kind === 'error' && (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {state.message}
          </div>
        )}

        {isDone && (
          <div className="mt-6 space-y-4 text-center">
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              Passkey registered. Encryption key derived on this device.
            </div>
            <Link
              to="/login"
              className="inline-block rounded-xl bg-teal-600 px-6 py-3 text-base font-semibold text-white shadow-md transition hover:bg-teal-700"
            >
              Now sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
