// Comemoração de meta batida: tela cheia de balões subindo e a mensagem.
// `celebrate()` (lib/celebration) pode ser chamado de qualquer lugar; <CelebrationLayer /> fica no Shell.

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { closeCelebration as close, currentCelebration, subscribeCelebration, type Party } from '../lib/celebration'

const COLORS = ['#8a00ff', '#c4a1ff', '#2fd18b', '#ffc857', '#ff5c7a', '#38bdf8', '#fb923c', '#f472b6', '#a855f7', '#5fe0a6']

interface Balloon {
  left: number
  size: number
  color: string
  delay: number
  duration: number
  drift: number
  top: number
}

function makeBalloons(n: number): Balloon[] {
  return Array.from({ length: n }, (_, i) => ({
    left: Math.random() * 100,
    size: 38 + Math.random() * 46,
    color: COLORS[i % COLORS.length],
    // atrasos negativos: parte dos balões já começa no meio do caminho, a tela enche na hora
    delay: -Math.random() * 9 + Math.random() * 3,
    duration: 7 + Math.random() * 7,
    drift: (Math.random() - 0.5) * 160,
    top: Math.random() * 85,
  }))
}

export function CelebrationLayer() {
  const party = useSyncExternalStore(subscribeCelebration, currentCelebration)
  if (!party) return null
  return <Overlay party={party} />
}

function Overlay({ party }: { party: Party }) {
  const [balloons] = useState(() => makeBalloons(window.innerWidth < 640 ? 26 : 48))
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm overflow-hidden" role="dialog" aria-modal="true" aria-label={party.title} onClick={close}>
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        {balloons.map((b, i) => (
          <span
            key={i}
            className="balloon"
            style={
              {
                left: `${b.left}%`,
                '--size': `${b.size}px`,
                '--color': b.color,
                '--delay': `${b.delay}s`,
                '--dur': `${b.duration}s`,
                '--drift': `${b.drift}px`,
                '--top': `${b.top}%`,
              } as CSSProperties
            }
          >
            <span className="balloon-body" />
          </span>
        ))}
      </div>

      <div className="relative card max-w-xl w-full p-6 sm:p-8 text-center shadow-2xl border-roxo/50" onClick={(e) => e.stopPropagation()}>
        <p className="text-5xl mb-3" aria-hidden="true">🎈🎉🎈</p>
        <h2 className="font-display font-black text-3xl sm:text-5xl leading-tight bg-gradient-to-r from-[#ffc857] via-[#c4a1ff] to-[#2fd18b] bg-clip-text text-transparent">{party.title}</h2>
        {party.subtitle && <p className="text-sm sm:text-base text-fumaca mt-4">{party.subtitle}</p>}
        {party.details && party.details.length > 0 && (
          <dl className="grid grid-cols-2 gap-3 mt-5 text-left">
            {party.details.map((d) => (
              <div key={d.label} className="rounded-lg bg-madrugada border border-border p-3">
                <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{d.label}</dt>
                <dd className="font-display font-bold text-lg tabular-nums mt-1">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <button className="btn-primary mt-6 w-full sm:w-auto" onClick={close} autoFocus>
          Bora pro próximo!
        </button>
      </div>
    </div>
  )
}
