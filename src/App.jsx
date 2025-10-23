import React from 'react'
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeContext'
import { AppProvider } from './contexts/AppContext'
import Landing from './pages/Landing'
import Paste from './pages/Paste'
import StaticPaste from './pages/StaticPaste'
import './index.css'
import DotGrid from './components/DotGrid'

// Background grid shown only on the home route
const BackgroundOverlay = () => {
  const location = useLocation()
  if (location.pathname !== '/') return null
  return (
    <div className="fixed inset-0 z-[1] pointer-events-none">
      <DotGrid
        dotSize={2}
        gap={17}
        baseColor="#3e4cecff"
        activeColor="#13ff4eff"
        proximity={130}
        speedTrigger={100}
        shockRadius={250}
        shockStrength={20}
        resistance={2000}
        returnDuration={1.5}
        alpha={0.35}
      />
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <div className="relative min-h-screen bg-black text-gray-200">
            <BackgroundOverlay />
            <div className="relative z-10">
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/paste" element={<Paste mode="guest" />} />
              <Route path="/admin" element={<Paste mode="admin" />} />
              <Route path="/v/:slug" element={<StaticPaste />} />
            </Routes>
            </div>
          </div>
        </Router>
      </AppProvider>
    </ThemeProvider>
  )
}

export default App
