import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  ArrowLeftRight,
  Building2,
  Database,
  LayoutDashboard,
  LineChart,
  Repeat,
  LogOut,
  Menu,
  Tags,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import { BrandMark, Eyebrow } from './Brand'
import { getSession, signOut } from '../data/session'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/transacoes', label: 'Transações', icon: ArrowLeftRight },
  { to: '/categorias', label: 'Categorias & Orçamento', icon: Tags },
  { to: '/fixas', label: 'Despesas fixas', icon: Repeat },
  { to: '/rendas', label: 'Fontes de renda', icon: Wallet },
  { to: '/investimentos', label: 'Investimentos', icon: TrendingUp },
  { to: '/patrimonio', label: 'Patrimônio & Contas', icon: Building2 },
  { to: '/crescimento', label: 'Crescimento', icon: LineChart },
  { to: '/dados', label: 'Importar / Exportar', icon: Database },
]

export function Shell() {
  const [open, setOpen] = useState(false)
  const email = getSession()?.user.email ?? ''
  return (
    <div className="min-h-full flex">
      {/* Sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 w-64 bg-madrugada border-r border-border flex flex-col transition-transform lg:translate-x-0 lg:sticky lg:top-0 lg:h-screen',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center px-5 h-16 border-b border-border">
          <BrandMark />
        </div>
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV.map((n, i) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                clsx(
                  'group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition',
                  isActive ? 'bg-roxo/12 text-papel' : 'text-fumaca hover:text-papel hover:bg-papel/[0.04]',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-roxo" />}
                  <n.icon size={17} className={isActive ? 'text-lilas' : ''} />
                  <span className="flex-1">{n.label}</span>
                  <span className={clsx('font-mono text-[10px]', isActive ? 'text-lilas' : 'text-tinta-fraca')}>{String(i + 1).padStart(2, '0')}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center font-display font-bold text-sm text-white shrink-0" style={{ backgroundImage: 'linear-gradient(135deg,#8a00ff,#5a22c7)' }}>
              {email.charAt(0).toUpperCase() || '?'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs truncate">{email}</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-income">● sincronizado</p>
            </div>
            <button className="btn-ghost p-1.5" onClick={signOut} title="Sair" aria-label="Sair">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col glow-top">
        <header className="lg:hidden flex items-center gap-3 h-14 px-4 border-b border-border bg-madrugada/80 backdrop-blur sticky top-0 z-20">
          <button className="btn-ghost p-2" onClick={() => setOpen(true)} aria-label="Menu">
            <Menu size={20} />
          </button>
          <BrandMark />
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1400px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  const { pathname } = useLocation()
  const idx = NAV.findIndex((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)))
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-7">
      <div>
        <Eyebrow>
          {idx >= 0 ? `${String(idx + 1).padStart(2, '0')} · ` : ''}Duzz Finance
        </Eyebrow>
        <h1 className="text-[30px] leading-tight font-bold mt-2">{title}</h1>
        {subtitle && <p className="text-sm text-fumaca mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
