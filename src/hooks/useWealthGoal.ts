import { useMemo } from 'react'
import {
  useAccounts,
  useAssetValuations,
  useAssets,
  useIncomeSources,
  useInvestmentMovements,
  useInvestmentSnapshots,
  useInvestments,
  useTransactions,
  useWealthCheckpoints,
  useWealthGoals,
} from './useData'
import { netWorthAt, type NetWorthParams } from '../lib/calc'
import { buildSchedule, salaryFromSources } from '../lib/wealthGoal'
import { todayISO } from '../lib/format'

/** Regra de patrimônio do usuário, checkpoints planejados e patrimônio de hoje */
export function useWealthGoal() {
  const goals = useWealthGoals()
  const stored = useWealthCheckpoints()
  const sources = useIncomeSources()
  const accounts = useAccounts()
  const txs = useTransactions()
  const investments = useInvestments()
  const movements = useInvestmentMovements()
  const snapshots = useInvestmentSnapshots()
  const assets = useAssets()
  const valuations = useAssetValuations()

  const params = useMemo<NetWorthParams>(
    () => ({ accounts, txs, investments, movements, snapshots, assets, valuations }),
    [accounts, txs, investments, movements, snapshots, assets, valuations],
  )
  const goal = goals[0]
  const derivedSalary = useMemo(() => salaryFromSources(sources), [sources])
  const salary = goal?.annualSalary ?? derivedSalary
  const today = todayISO()
  const netWorthNow = useMemo(() => netWorthAt(params, today).netWorth, [params, today])
  const schedule = useMemo(() => (goal ? buildSchedule(goal, salary) : []), [goal, salary])

  return { goal, stored, params, salary, derivedSalary, today, netWorthNow, schedule }
}
