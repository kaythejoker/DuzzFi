import { useState, type FormEvent } from 'react'
import { ArrowRight, Lock, Mail } from 'lucide-react'
import { supabase } from '../data/supabase'
import { DuzzLogo, Eyebrow } from '../components/Brand'

type Mode = 'login' | 'signup' | 'reset'

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error('Use uma senha com pelo menos 8 caracteres.')
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
        if (error) throw error
        if (!data.session) setInfo('Conta criada. Confirme pelo link que enviamos para o seu email e depois entre.')
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
        if (error) throw error
        setInfo('Se o email existir, você vai receber um link para redefinir a senha.')
      }
    } catch (err) {
      const msg = (err as Error).message
      setError(
        /invalid login credentials/i.test(msg)
          ? 'Email ou senha incorretos.'
          : /email not confirmed/i.test(msg)
            ? 'Confirme seu email pelo link que enviamos antes de entrar.'
            : /already registered/i.test(msg)
              ? 'Já existe uma conta com esse email.'
              : msg,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="glow-top min-h-full flex flex-col">
      <header className="flex items-center justify-between px-6 h-16 border-b border-border">
        <DuzzLogo width={86} />
        <span className="eyebrow hidden sm:block">Finance · uso pessoal</span>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <Eyebrow className="justify-center">Controle financeiro · crescimento</Eyebrow>
            <h1 className="mt-4 text-[34px] leading-[1.08] font-bold text-papel">
              Cada real no lugar certo.
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#b36bff] to-roxo">Todo o crescimento à vista.</span>
            </h1>
            <p className="mt-4 text-sm text-fumaca">
              Gastos, rendas, investimentos, empresas e sociedades num só painel.
            </p>
          </div>

          <form onSubmit={submit} className="card p-6 space-y-4">
            <div className="flex rounded-full border border-border bg-madrugada/60 p-1">
              {(['login', 'signup'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setError(''); setInfo('') }}
                  className={`flex-1 rounded-full py-1.5 text-sm transition cursor-pointer ${mode === m ? 'bg-papel text-tinta font-display font-bold' : 'text-fumaca hover:text-papel'}`}
                >
                  {m === 'login' ? 'Entrar' : 'Criar conta'}
                </button>
              ))}
            </div>

            <label className="block">
              <span className="label">Email</span>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fumaca" />
                <input className="input pl-9" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
              </div>
            </label>

            {mode !== 'reset' && (
              <label className="block">
                <span className="label">Senha</span>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fumaca" />
                  <input
                    className="input pl-9"
                    type="password"
                    required
                    minLength={mode === 'signup' ? 8 : undefined}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'signup' ? 'mínimo 8 caracteres' : '••••••••'}
                  />
                </div>
              </label>
            )}

            {error && <p className="text-sm text-expense">{error}</p>}
            {info && <p className="text-sm text-income">{info}</p>}

            <button className="btn-primary w-full py-2.5" disabled={busy}>
              {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Criar minha conta' : 'Enviar link'}
              {!busy && <ArrowRight size={16} />}
            </button>

            <div className="text-center">
              {mode === 'reset' ? (
                <button type="button" className="text-xs text-fumaca hover:text-papel underline underline-offset-4 cursor-pointer" onClick={() => setMode('login')}>
                  Voltar para o login
                </button>
              ) : mode === 'login' ? (
                <button type="button" className="text-xs text-fumaca hover:text-papel underline underline-offset-4 cursor-pointer" onClick={() => setMode('reset')}>
                  Esqueci minha senha
                </button>
              ) : null}
            </div>
          </form>

          <p className="eyebrow text-center mt-6 normal-case tracking-normal text-[11px]">
            Seus dados ficam no seu banco Supabase, protegidos por usuário.
          </p>
        </div>
      </main>
    </div>
  )
}

/** Mostrado quando as variáveis do Supabase não foram configuradas */
export function SetupPage() {
  return (
    <div className="glow-top min-h-full flex items-center justify-center p-6">
      <div className="card max-w-lg w-full p-6">
        <DuzzLogo width={86} />
        <Eyebrow className="mt-6">Configuração</Eyebrow>
        <h1 className="text-2xl font-bold mt-2">Conecte o banco Supabase</h1>
        <p className="text-sm text-fumaca mt-2">
          Crie o arquivo <code className="font-mono text-lilas">.env.local</code> na raiz do projeto com a URL e a chave publicável do seu projeto e reinicie o servidor:
        </p>
        <pre className="mt-4 rounded-lg bg-madrugada border border-border p-3 text-xs font-mono text-papel overflow-x-auto">
{`VITE_SUPABASE_URL=https://<seu-projeto>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`}
        </pre>
      </div>
    </div>
  )
}
