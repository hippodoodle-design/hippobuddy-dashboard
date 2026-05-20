import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './routes/Home'
import Enrol from './routes/Enrol'
import Login from './routes/Login'
import Dashboard from './routes/Dashboard'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/enrol" element={<Enrol />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  )
}
