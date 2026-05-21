import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import ProtectedRoute from './auth/ProtectedRoute'
import Home from './routes/Home'
import Enrol from './routes/Enrol'
import Login from './routes/Login'
import Dashboard from './routes/Dashboard'
import Import from './routes/Import'
import AddDevice from './routes/AddDevice'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/enrol" element={<Enrol />} />
          <Route path="/login" element={<Login />} />
          <Route path="/add-device" element={<AddDevice />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/import"
            element={
              <ProtectedRoute>
                <Import />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
