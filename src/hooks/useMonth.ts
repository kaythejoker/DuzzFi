import { useCallback, useState } from 'react'
import { currentYM } from '../lib/format'

const KEY = 'duzz.month'

/** Mês selecionado (yyyy-MM), compartilhado entre páginas via sessionStorage */
export function useMonth() {
  const [ym, setYm] = useState<string>(() => {
    try {
      return window.sessionStorage.getItem(KEY) || currentYM()
    } catch {
      return currentYM()
    }
  })
  const set = useCallback((v: string) => {
    setYm(v)
    try {
      window.sessionStorage.setItem(KEY, v)
    } catch {
      /* ignore */
    }
  }, [])
  return [ym, set] as const
}
