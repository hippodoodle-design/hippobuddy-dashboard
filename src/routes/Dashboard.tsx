import { useAuth } from '../auth/AuthContext'

export default function Dashboard() {
  const { logout } = useAuth()

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-purple-600 via-purple-500 to-teal-400 p-6">
      <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl px-10 py-12 max-w-md w-full text-center">
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
          Signed in
        </h1>
        <p className="mt-4 text-sm text-slate-600">
          Encryption key in memory. Ready for credentials.
        </p>
        <button
          type="button"
          onClick={logout}
          className="mt-8 inline-block rounded-xl border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
