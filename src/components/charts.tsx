import { fmtBRL, fmtCompact, fmtMonthShort } from '../lib/format'

export const axisStyle = { fontSize: 10.5, fill: '#9a9aa5', fontFamily: 'Geist Mono, monospace' }
export const gridStroke = '#1f1f29'

export function moneyTick(v: number) {
  return fmtCompact(v)
}

export function monthTick(ym: string) {
  return fmtMonthShort(ym)
}

export function tooltipMoney(value: unknown) {
  return fmtBRL(Number(value))
}

export function tooltipLabelMonth(label: unknown) {
  return typeof label === 'string' && /^\d{4}-\d{2}$/.test(label) ? fmtMonthShort(label) : String(label)
}

export const tooltipStyle = {
  contentStyle: {
    background: '#14141b',
    border: '1px solid #2a2a36',
    borderRadius: 12,
    fontSize: 12,
  },
  labelStyle: { color: '#f4f4f6', fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: '#f4f4f6' },
}
