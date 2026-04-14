import React, { createContext, useContext, useState } from 'react'
import { db } from '../lib/api'

const AppContext = createContext()

export const useApp = () => {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useApp must be used within an AppProvider')
  }
  return context
}

export const AppProvider = ({ children }) => {
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

  // Initialize from cookies so direct /admin access survives page refresh
  const [mode, setMode] = useState(() => getCookie('mode') || null)

  const setPasscodeMode = async (code) => {
    try {
      const res = await db.verifyPasscode(code)
      if (res && res.valid) {
        setMode('passcode')
        setCookie('mode', 'passcode')
        return true
      }
      return false
    } catch {
      return false
    }
  }

  const setGuestMode = () => {
    setMode('guest')
    deleteCookie('mode')
    setCookie('mode', 'guest')
  }

  // FIXED: async + await logout so cookie is cleared on server BEFORE
  // the app navigates away. Without await, a quick re-login would race
  // the logout request, and the server would delete the *new* session token.
  const resetMode = async () => {
    setMode(null)
    deleteCookie('mode')
    try {
      await db.logout()
    } catch {
      // ignore network errors — local state is already cleared
    }
  }

  return (
    <AppContext.Provider value={{
      mode,
      setPasscodeMode,
      setGuestMode,
      resetMode,
    }}>
      {children}
    </AppContext.Provider>
  )
}
