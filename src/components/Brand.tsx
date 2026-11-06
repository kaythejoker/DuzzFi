import { useState } from 'react'
import clsx from 'clsx'

const LOGO_URL = 'https://duzz-c.vercel.app/marca/duzz.png'

/** Logotipo DUZZ (mesmo arquivo do site), em branco. Cai para texto se a imagem não carregar. */
export function DuzzLogo({ className, width = 86 }: { className?: string; width?: number }) {
  const [failed, setFailed] = useState(false)
  if (failed)
    return (
      <span className={clsx('font-display font-extrabold tracking-[0.12em] text-papel', className)} style={{ fontSize: width / 4.2 }}>
        DUZZ
      </span>
    )
  return (
    <img
      src={LOGO_URL}
      alt="DUZZ"
      width={width}
      className={clsx('h-auto select-none', className)}
      style={{ filter: 'brightness(0) invert(1)' }}
      onError={() => setFailed(true)}
      draggable={false}
    />
  )
}

/** Logo + selo "Finance" */
export function BrandMark({ className }: { className?: string }) {
  return (
    <div className={clsx('flex items-center gap-2.5', className)}>
      <DuzzLogo width={78} />
      <span className="rounded-full border border-roxo/40 bg-roxo/10 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-lilas">
        Finance
      </span>
    </div>
  )
}

/** Rótulo "✦ TEXTO · TEXTO" no estilo do site */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={clsx('eyebrow flex items-center gap-2', className)}>
      <span className="text-roxo text-[13px] leading-none">✦</span>
      {children}
    </p>
  )
}
