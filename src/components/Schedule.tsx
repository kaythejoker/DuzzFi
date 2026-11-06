import { CalendarClock, Check } from 'lucide-react'
import clsx from 'clsx'
import type { ScheduleItem, ScheduleStatus } from '../lib/payday'
import { fmtBRL, fmtDate } from '../lib/format'
import { Dot } from './ui'

function relative(date: string, days: number, status: ScheduleStatus) {
  if (status === 'late') return `era dia ${fmtDate(date, 'dd/MM')} · há ${-days} dia${days === -1 ? '' : 's'}`
  if (status === 'today') return 'hoje'
  if (days === 1) return 'amanhã'
  return `em ${days} dias`
}

/**
 * Grade com a próxima data de cada item recorrente (recebimentos ou contas).
 * `doneLabel` é o que aparece quando já foi lançado no mês ("recebido", "pago").
 */
export function ScheduleGrid({
  items,
  doneLabel,
  actionLabel,
  lateHint,
}: {
  items: ScheduleItem[]
  doneLabel: string
  actionLabel?: string
  lateHint?: string
}) {
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {items.map((e) => (
        <div
          key={e.key}
          className={clsx(
            'rounded-xl border p-3 min-w-0',
            e.status === 'late' ? 'border-warn/40 bg-warn/5' : e.status === 'today' ? 'border-brand/50 bg-brand/5' : 'border-border',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 min-w-0 text-sm font-medium">
              <Dot color={e.color} />
              <span className="truncate">{e.name}</span>
            </span>
            <span className="text-[11px] text-muted shrink-0 font-mono">dia {e.day}</span>
          </div>

          <div className="mt-2 flex items-end justify-between gap-2">
            <div className="min-w-0">
              <p className="font-display text-lg font-semibold leading-tight">{fmtDate(e.date, 'dd MMM')}</p>
              <p
                className={clsx(
                  'text-xs flex items-center gap-1',
                  e.status === 'late' ? 'text-warn' : e.status === 'done' ? 'text-income' : e.status === 'today' ? 'text-lilas' : 'text-muted',
                )}
              >
                {e.status === 'done' ? (
                  <><Check size={12} /> {doneLabel} · próximo {relative(e.date, e.days, e.status)}</>
                ) : e.status === 'late' ? (
                  <><CalendarClock size={12} /> {relative(e.date, e.days, e.status)}</>
                ) : (
                  relative(e.date, e.days, e.status)
                )}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm tabular-nums">{fmtBRL(e.amount)}</p>
              {e.onAction && actionLabel && e.status !== 'done' && (
                <button className="text-[11px] text-brand hover:underline cursor-pointer" onClick={e.onAction}>
                  {actionLabel}
                </button>
              )}
            </div>
          </div>
          {e.status === 'late' && lateHint && <p className="text-[11px] text-muted mt-2">{lateHint}</p>}
        </div>
      ))}
    </div>
  )
}
