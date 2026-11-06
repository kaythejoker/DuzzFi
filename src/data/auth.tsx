import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { setCurrentSession } from './session'
import { supabase, supabaseConfigured } from './supabase'
import { loadAll, resetStore, useStore } from './store'
import { seedIfNeeded } from '../db/seed'
import { LoginPage, SetupPage } from '../pages/Login'
import { DuzzLogo } from '../components/Brand'

/** Só renderiza o app depois do login e da carga inicial dos dados */
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const status = useStore('status')
  const error = useStore('error')

  useEffect(() => {
    if (!supabaseConfigured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  useEffect(() => {
    setCurrentSession(session ?? null)
    if (!userId) {
      resetStore()
      return
    }
    loadAll().then(() => seedIfNeeded())
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!supabaseConfigured) return <SetupPage />
  if (session === undefined) return <Splash />
  if (!session) return <LoginPage />
  if (status === 'error')
    return (
      <Splash>
        <p className="text-sm text-expense max-w-md text-center">Não consegui carregar seus dados: {error}</p>
        <button className="btn-secondary mt-4" onClick={() => loadAll()}>Tentar de novo</button>
      </Splash>
    )
  if (status !== 'ready') return <Splash />
  return <>{children}</>
}

function Splash({ children }: { children?: ReactNode }) {
  return (
    <div className="glow-top min-h-full flex flex-col items-center justify-center p-6">
      <DuzzLogo width={110} className="animate-pulse" />
      <div className="mt-6">{children}</div>
    </div>
  )
}
