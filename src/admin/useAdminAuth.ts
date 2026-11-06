import { useCallback, useEffect, useState } from 'react'
import { requireSupabase } from '@/lib/supabase'
import { isBackendConfigured } from '@/lib/env'

/**
 * Admin sign-in (§28).
 *
 * Real email auth, separate from the anonymous sessions customers get. Signing in here proves
 * who you are; whether you may do anything is decided by the server on every call.
 */
export function useAdminAuth() {
  const [email, setEmail] = useState<string | null>(null)
  const [checking, setChecking] = useState(isBackendConfigured)

  useEffect(() => {
    if (!isBackendConfigured) return
    const supabase = requireSupabase()

    let cancelled = false
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      // An anonymous customer session is not an admin session.
      const user = data.session?.user
      setEmail(user && user.is_anonymous !== true ? (user.email ?? null) : null)
      setChecking(false)
    })

    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async (address: string, password: string) => {
    const supabase = requireSupabase()
    const { data, error } = await supabase.auth.signInWithPassword({
      email: address,
      password,
    })
    if (error) throw new Error(error.message)
    setEmail(data.user.email ?? address)
  }, [])

  const signOut = useCallback(async () => {
    await requireSupabase().auth.signOut()
    setEmail(null)
  }, [])

  return { email, checking, signIn, signOut }
}
