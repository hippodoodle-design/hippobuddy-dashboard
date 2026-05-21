import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

type LoginState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'error'; message: string }

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState<LoginState>({ kind: 'idle' })

  async function handleLogin() {
    setState({ kind: 'working' })
    const result = await login()
    if (result.ok) {
      navigate('/dashboard', { replace: true })
    } else {
      setState({ kind: 'error', message: result.reason })
    }
  }

  const isWorking = state.kind === 'working'

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-sky-500 via-teal-400 to-emerald-400 p-6">
      <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl px-10 py-12 max-w-md w-full">
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight text-center">
          Sign in
        </h1>
        <p className="mt-3 text-sm text-slate-600 text-center">
          Use the passkey on this device. Your encryption key never leaves it.
        </p>

        <button
          type="button"
          onClick={handleLogin}
          disabled={isWorking}
          className="mt-8 w-full rounded-xl bg-teal-600 px-6 py-3 text-base font-semibold text-white shadow-md transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isWorking ? 'Signing in…' : 'Sign in with passkey'}
        </button>

        {state.kind === 'error' && (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {state.message}
          </div>
        )}

        <p className="mt-8 text-center text-sm text-slate-600">
          No passkey yet?{' '}
          <Link to="/enrol" className="font-medium text-teal-700 hover:underline">
            Enrol this device
          </Link>
        </p>
      </div>
    </div>
  )
}
