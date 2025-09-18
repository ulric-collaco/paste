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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="rentry-container min-h-[calc(100vh-80px)] flex items-center justify-center">
        <div className="max-w-md w-full">
          <div className="rentry-header">
            <h1 className="text-6xl font-extralight text-gray-900 dark:text-gray-100 mb-6 tracking-tight">
              Pastry
            </h1>
            <p className="text-xl text-gray-500 dark:text-gray-400 font-light leading-relaxed">
              markdown pastebin service
            </p>
          </div>

          <div className="space-y-4">
            {/* Passcode Mode */}
            <div className="card p-8">
              <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                Enter with passcode
              </h2>
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-6 leading-relaxed">
                Access your personal, permanent paste that you can edit anytime.
              </p>
              
              {!showPasscodeInput ? (
                <button
                  onClick={() => setShowPasscodeInput(true)}
                  className="rentry-button w-full"
                >
                  Enter Passcode
                </button>
              ) : (
                <form onSubmit={handlePasscodeSubmit} className="space-y-4">
                  <input
                    type="password"
                    placeholder="Enter your passcode..."
                    value={passcodeInput}
                    onChange={(e) => setPasscodeInput(e.target.value)}
                    className="input-field"
                    autoFocus
                    required
                  />
                  
                  {/* Error message */}
                  {passcodeError && (
                    <div className="flex items-center text-red-600 dark:text-red-400 text-sm">
                      <AlertCircle className="w-4 h-4 mr-2" />
                      {passcodeError}
                    </div>
                  )}
                  
                  <div className="flex space-x-3">
                    <button type="submit" className="rentry-button flex-1">
                      Continue
                    </button>
                    <button
                      type="button"
                      onClick={resetPasscodeInput}
                      className="rentry-button-secondary px-6"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Guest Mode */}
            <div className="card p-8">
              <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                Continue as guest
              </h2>
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-6 leading-relaxed">
                Create a temporary paste that automatically expires after 2 hours.
              </p>
              <button
                onClick={handleGuestMode}
                className="rentry-button-secondary w-full"
              >
                Continue as Guest
              </button>
            </div>
          </div>

          <div className="mt-12 text-center">
            <p className="text-sm text-gray-400 dark:text-gray-500 font-light">
              no registration • anonymous • markdown support
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Landing
