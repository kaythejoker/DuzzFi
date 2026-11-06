import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

let currentSession: Session | null = null

export const getSession = () => currentSession
export const setCurrentSession = (s: Session | null) => {
  currentSession = s
}

export async function signOut() {
  await supabase.auth.signOut()
}
