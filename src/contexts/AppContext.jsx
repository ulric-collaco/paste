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
  // Cookie helpers (simple, no external dep)
  const setCookie = (name, value, days = 7) => {
    if (typeof document === 'undefined') return
    const expires = new Date(Date.now() + days * 864e5).toUTCString()
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`
  }

  const getCookie = (name) => {
    if (typeof document === 'undefined') return null
    return document.cookie.split('; ').reduce((r, v) => {
      const parts = v.split('=')
      return parts[0] === name ? decodeURIComponent(parts[1]) : r
    }, null)
  }

  const deleteCookie = (name) => {
    if (typeof document === 'undefined') return
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  }

  // Initialize from cookies so direct /admin access requires a valid cookie
  const [mode, setMode] = useState(() => getCookie('mode') || null) // 'passcode' or 'guest'
  const [passcode, setPasscode] = useState(() => getCookie('passcode') || '')

  // Validate passcode against environment variable
  const validatePasscode = (inputPasscode) => {
    const validPasscode = import.meta.env.VITE_DEV_PASSCODE
    return inputPasscode === validPasscode
  }

  const setPasscodeMode = (code) => {
    if (validatePasscode(code)) {
      setMode('passcode')
      setPasscode(code)
      try {
        setCookie('mode', 'passcode')
        setCookie('passcode', code)
      } catch (e) {
        // ignore
      }
      return true
    }
    return false
  }

  const setGuestMode = () => {
    setMode('guest')
    setPasscode('')
    try {
      setCookie('mode', 'guest')
      deleteCookie('passcode')
    } catch (e) {
      // ignore
    }
  }

  const resetMode = () => {
    setMode(null)
    setPasscode('')
    try {
      deleteCookie('mode')
      deleteCookie('passcode')
    } catch (e) {
      // ignore
    }
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
