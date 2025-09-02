import React, { createContext, useContext, useState } from 'react'

const AppContext = createContext()

export const useApp = () => {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useApp must be used within an AppProvider')
  }
  return context
}

export const AppProvider = ({ children }) => {
  const [mode, setMode] = useState(null) // 'passcode' or 'guest'
  const [passcode, setPasscode] = useState('')

  // Validate passcode against environment variable
  const validatePasscode = (inputPasscode) => {
    const validPasscode = import.meta.env.VITE_DEV_PASSCODE
    return inputPasscode === validPasscode
  }

  const setPasscodeMode = (code) => {
    if (validatePasscode(code)) {
      setMode('passcode')
      setPasscode(code)
      return true
    }
    return false
  }

  const setGuestMode = () => {
    setMode('guest')
    setPasscode('')
  }

  const resetMode = () => {
    setMode(null)
    setPasscode('')
  }

  return (
    <AppContext.Provider value={{
      mode,
      passcode,
      setPasscodeMode,
      setGuestMode,
      resetMode,
      validatePasscode
    }}>
      {children}
    </AppContext.Provider>
  )
}
