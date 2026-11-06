import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fmtMonthLong, currentYM } from '../lib/format'
import { shiftYM } from '../lib/dates'

export function MonthPicker({ value, onChange }: { value: string; onChange: (ym: string) => void }) {
  const isCurrent = value === currentYM()
  return (
    <div className="inline-flex items-center gap-1 bg-surface border border-border rounded-full p-1">
      <button className="btn-ghost p-1.5" onClick={() => onChange(shiftYM(value, -1))} aria-label="Mês anterior">
        <ChevronLeft size={16} />
      </button>
      <button
        className="px-2 font-display text-sm font-bold min-w-[150px] text-center cursor-pointer hover:text-lilas"
        onClick={() => onChange(currentYM())}
        title="Voltar para o mês atual"
      >
        {fmtMonthLong(value)}
      </button>
      <button
        className="btn-ghost p-1.5"
        onClick={() => onChange(shiftYM(value, 1))}
        aria-label="Próximo mês"
        disabled={isCurrent}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )
}
