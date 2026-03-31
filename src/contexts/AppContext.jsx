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



  // Validate passcode against server
  const validatePasscode = async (inputPasscode) => {
    try {
      const res = await db.verifyPasscode(inputPasscode)
      if (res && res.valid && res.token) {
        return res.token;
      }
      return null
    } catch {
      return null
    }
  }

  const setPasscodeMode = async (code) => {
    const token = await validatePasscode(code)
    if (token) {
      setMode('passcode')
      setPasscode('hidden') // don't store plain passcode
      try {
        setCookie('mode', 'passcode')
        setCookie('session_token', token) // Store token!
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
      deleteCookie('session_token') // update deletion
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
      validatePasscode,
      getCookie
    }}>
      {children}
    </AppContext.Provider>
  )
}
