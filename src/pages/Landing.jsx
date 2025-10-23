import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { useApp } from '../contexts/AppContext'

const Landing = () => {
  const [passcodeInput, setPasscodeInput] = useState('')
  const [showPasscodeInput, setShowPasscodeInput] = useState(false)
  const [passcodeError, setPasscodeError] = useState('')
  const { setPasscodeMode, setGuestMode } = useApp()
  const navigate = useNavigate()

  const handlePasscodeSubmit = (e) => {
    e.preventDefault()
    setPasscodeError('')
    
    if (passcodeInput.trim()) {
      const isValid = setPasscodeMode(passcodeInput.trim())
      if (isValid) {
        // After successful passcode entry, navigate to admin route
        navigate('/admin')
      } else {
        setPasscodeError('Invalid passcode. Please try again.')
        setPasscodeInput('')
      }
    }
  }

  const handleGuestMode = () => {
    setGuestMode()
    navigate('/paste')
  }

  const resetPasscodeInput = () => {
    setShowPasscodeInput(false)
    setPasscodeInput('')
    setPasscodeError('')
  }

  return (
    <div className="min-h-screen">
      <div className="container-page min-h-[calc(100vh-80px)] flex items-center justify-center">
        <div className="w-full max-w-md relative z-10">
          <header className="text-center mb-10">
            <h1 className="heading-xl">Pastry</h1>
            <p className="mt-3 text-neutral-400">Minimal markdown paste</p>
          </header>

          <div className="space-y-4">
            <div className="surface p-6">
              <h2 className="text-base text-white mb-2">Enter with passcode</h2>
              <p className="muted mb-5">Access your personal, permanent paste.</p>

              {!showPasscodeInput ? (
                <button onClick={() => setShowPasscodeInput(true)} className="btn btn-primary w-full">
                  Enter Passcode
                </button>
              ) : (
                <form onSubmit={handlePasscodeSubmit} className="space-y-3">
                  <input
                    type="password"
                    placeholder="Passcode"
                    value={passcodeInput}
                    onChange={(e) => setPasscodeInput(e.target.value)}
                    className="input"
                    autoFocus
                    required
                  />
                  {passcodeError && (
                    <div className="flex items-center text-red-400 text-sm">
                      <AlertCircle className="w-4 h-4 mr-2" />
                      {passcodeError}
                    </div>
                  )}
                  <div className="flex gap-3">
                    <button type="submit" className="btn btn-primary flex-1">Continue</button>
                    <button type="button" onClick={resetPasscodeInput} className="btn btn-ghost px-6">Cancel</button>
                  </div>
                </form>
              )}
            </div>

            <div className="surface p-6">
              <h2 className="text-base text-white mb-2">Continue as guest</h2>
              <p className="muted mb-5">Create a shared paste that expires after 2 hours.</p>
              <button onClick={handleGuestMode} className="btn w-full">Continue as Guest</button>
            </div>
          </div>

          <div className="mt-10 text-center">
            <p className="muted">no account • anonymous • markdown</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Landing
