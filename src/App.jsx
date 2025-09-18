import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeContext'
import { AppProvider } from './contexts/AppContext'
import Landing from './pages/Landing'
import Paste from './pages/Paste'
import StaticPaste from './pages/StaticPaste'
import './index.css'

function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <Router>
          <div className="min-h-screen bg-gray-50 dark:bg-dark-900">
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/paste" element={<Paste mode="guest" />} />
              <Route path="/admin" element={<Paste mode="admin" />} />
              <Route path="/v/:slug" element={<StaticPaste />} />
            </Routes>
          </div>
        </Router>
      </AppProvider>
    </ThemeProvider>
  )
}

export default App
