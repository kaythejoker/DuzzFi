import { CalendarClock, Check } from 'lucide-react'
import clsx from 'clsx'
import type { PayEvent } from '../lib/payday'
import { fmtBRL, fmtDate } from '../lib/format'
import { Dot } from './ui'

function relative(e: PayEvent) {
  if (e.status === 'late') return `era dia ${fmtDate(e.date, 'dd/MM')} · há ${-e.days} dia${e.days === -1 ? '' : 's'}`
  if (e.status === 'today') return 'cai hoje'
  if (e.days === 1) return 'amanhã'
  return `em ${e.days} dias`
}

/** Grade de cartões com o próximo recebimento de cada fonte */
export function UpcomingIncome({
  events,
  onLaunch,
}: {
  events: PayEvent[]
  /** quando informado, mostra "lançar" nos recebimentos que ainda não entraram */
  onLaunch?: (e: PayEvent) => void
}) {
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {events.map((e) => (
        <div
          key={e.source.id}
          className={clsx(
            'rounded-xl border p-3 min-w-0',
            e.status === 'late' ? 'border-warn/40 bg-warn/5' : e.status === 'today' ? 'border-income/40 bg-income/5' : 'border-border',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 min-w-0 text-sm font-medium">
              <Dot color={e.source.color} />
              <span className="truncate">{e.source.name}</span>
            </span>
            <span className="text-[11px] text-muted shrink-0 font-mono">dia {e.source.payDay}</span>
          </div>

          <div className="mt-2 flex items-end justify-between gap-2">
            <div className="min-w-0">
              <p className="font-display text-lg font-semibold leading-tight">{fmtDate(e.date, 'dd MMM')}</p>
              <p
                className={clsx(
                  'text-xs flex items-center gap-1',
                  e.status === 'late' ? 'text-warn' : e.status === 'today' || e.status === 'received' ? 'text-income' : 'text-muted',
                )}
              >
                {e.status === 'received' ? (
                  <><Check size={12} /> recebido · próximo {relative(e)}</>
                ) : e.status === 'late' ? (
                  <><CalendarClock size={12} /> {relative(e)}</>
                ) : (
                  relative(e)
                )}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm tabular-nums">{fmtBRL(e.status === 'received' ? e.receivedThisMonth : e.source.expectedMonthly)}</p>
              {onLaunch && e.status !== 'received' && (
                <button className="text-[11px] text-brand hover:underline cursor-pointer" onClick={() => onLaunch(e)}>
                  lançar
                </button>
              )}
            </div>
          </div>
          {e.status === 'late' && (
            <p className="text-[11px] text-muted mt-2">Nenhum recebimento vinculado a esta fonte no mês.</p>
          )}
        </div>
      ))}
    </div>
  )
}
