import { X } from 'lucide-react'
import clsx from 'clsx'
import { useEffect, useState, type ReactNode } from 'react'
import { fmtBRL, parseMoney } from '../lib/format'
import { PALETTE } from '../db/types'

// ---------- Card ----------
export function Card({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={clsx('card min-w-0', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
          <div>
            {title && <h3 className="font-display text-[15px] font-bold text-text">{title}</h3>}
            {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={clsx('px-5 pb-5', !title && 'pt-5', bodyClassName)}>{children}</div>
    </section>
  )
}

// ---------- KPI ----------
export function Kpi({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
}: {
  label: string
  value: string
  hint?: ReactNode
  tone?: 'neutral' | 'income' | 'expense' | 'invest' | 'accent'
  icon?: ReactNode
}) {
  const toneCls = {
    neutral: 'text-text',
    income: 'text-income',
    expense: 'text-expense',
    invest: 'text-invest',
    accent: 'text-accent',
  }[tone]
  return (
    <div className="card min-w-0 p-4 flex items-start justify-between gap-3 transition-colors duration-[180ms] hover:border-roxo/40">
      <div className="min-w-0">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted">{label}</p>
        <p className={clsx('font-display text-[22px] font-bold tracking-tight mt-1.5 truncate tabular-nums', toneCls)}>{value}</p>
        {hint && <div className="text-xs text-muted mt-1">{hint}</div>}
      </div>
      {icon && <div className="text-tinta-fraca shrink-0 [&_svg]:w-[18px] [&_svg]:h-[18px]">{icon}</div>}
    </div>
  )
}

export function Delta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value == null) return <span>sem comparação</span>
  const good = invert ? value <= 0 : value >= 0
  return (
    <span className={good ? 'text-income' : 'text-expense'}>
      {value >= 0 ? '▲' : '▼'} {Math.abs(value * 100).toFixed(1)}% vs mês anterior
    </span>
  )
}

// ---------- Modal ----------
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className={clsx('card w-full shadow-2xl max-h-[92vh] flex flex-col', width)}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn-ghost p-1.5" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <footer className="px-5 py-3 border-t border-border flex justify-end gap-2">{footer}</footer>}
      </div>
    </div>
  )
}

export function Confirm({
  open,
  onClose,
  onConfirm,
  title = 'Tem certeza?',
  message,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title?: string
  message: ReactNode
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="max-w-sm"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-danger" onClick={() => { onConfirm(); onClose() }}>Excluir</button>
        </>
      }
    >
      <p className="text-sm text-muted">{message}</p>
    </Modal>
  )
}

// ---------- Form helpers ----------
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted mt-1 block">{hint}</span>}
    </label>
  )
}

export function MoneyInput({
  value,
  onChange,
  placeholder = '0,00',
  autoFocus,
}: {
  value: number
  onChange: (v: number) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const [text, setText] = useState(value ? value.toFixed(2).replace('.', ',') : '')
  useEffect(() => {
    // sincroniza quando o valor é alterado externamente (ex.: reset do formulário)
    const parsed = parseMoney(text)
    if (Math.abs(parsed - value) > 0.004) setText(value ? value.toFixed(2).replace('.', ',') : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">R$</span>
      <input
        className="input pl-9"
        inputMode="decimal"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onChange(parseMoney(e.target.value))
        }}
        onBlur={() => {
          const v = parseMoney(text)
          setText(v ? v.toFixed(2).replace('.', ',') : '')
        }}
      />
    </div>
  )
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={clsx(
            'w-6 h-6 rounded-full border-2 transition cursor-pointer',
            value === c ? 'border-papel scale-110' : 'border-transparent hover:scale-105',
          )}
          style={{ background: c }}
          aria-label={c}
        />
      ))}
    </div>
  )
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <span className="inline-block rounded-full shrink-0" style={{ background: color, width: size, height: size }} />
}

export function Badge({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={clsx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium', className)}
      style={color ? { background: `${color}22`, color } : undefined}
    >
      {color && <Dot color={color} size={6} />}
      {children}
    </span>
  )
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4">
      {icon && <div className="text-muted mb-3">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && <p className="text-sm text-muted mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Money({ value, signed = false, className }: { value: number; signed?: boolean; className?: string }) {
  const tone = value > 0 ? 'text-income' : value < 0 ? 'text-expense' : 'text-muted'
  return (
    <span className={clsx('tabular-nums', signed && tone, className)}>
      {signed ? (value < 0 ? '- ' : '+ ') + fmtBRL(Math.abs(value)) : fmtBRL(value)}
    </span>
  )
}

export function ProgressBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const over = max > 0 && value > max
  return (
    <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, background: over ? 'var(--color-expense)' : color ?? 'var(--color-brand)' }}
      />
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
}) {
  return (
    <div className="inline-flex rounded-full bg-madrugada/60 border border-border p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            'px-3 py-1 rounded-full text-sm transition cursor-pointer',
            value === o.value ? 'bg-papel text-tinta font-display font-bold' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
