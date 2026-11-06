import { useMemo } from 'react'
import { useStore } from '../data/store'

export const useAccounts = () => useStore('accounts')
export const useCategories = () => useStore('categories')
export const useTransactions = () => useStore('transactions')
export const useIncomeSources = () => useStore('incomeSources')
export const useInvestments = () => useStore('investments')
export const useInvestmentMovements = () => useStore('investmentMovements')
export const useInvestmentSnapshots = () => useStore('investmentSnapshots')
export const useAssets = () => useStore('assets')
export const useAssetValuations = () => useStore('assetValuations')

export function useById<T extends { id?: number }>(list: T[]) {
  return useMemo(() => {
    const m = new Map<number, T>()
    for (const x of list) if (x.id != null) m.set(x.id, x)
    return m
  }, [list])
}
