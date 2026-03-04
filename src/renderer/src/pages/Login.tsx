import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Key, Loader2, ExternalLink, CheckCircle2 } from 'lucide-react'
import { electron } from '@/lib/electron'
import orbitIcon from '@/assets/icon.png'
import { useAuthStore, useRepoStore, useSettingsStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { notify } from '@/lib/notify'

export function Login(): JSX.Element {
  const navigate = useNavigate()
  const { setUser } = useAuthStore()
  const { setRepos } = useRepoStore()
  const { setSettings } = useSettingsStore()
  const [token, setToken] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleLogin = async () => {
    if (!token.trim()) return
    setIsLoading(true)
    try {
      const result = await electron.auth.login(token.trim())
      setUser(result.user)
      const [repos, settings] = await Promise.all([
        electron.repos.list(),
        electron.settings.get()
      ])
      setRepos(repos)
      setSettings(settings)
      navigate('/repos')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Token inválido ou sem permissões'
      notify('failure', 'Erro de autenticação', msg)
    } finally {
      setIsLoading(false)
    }
  }

  const scopes = ['repo', 'workflow', 'read:user', 'user:email']

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      {/* Decorative blur */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full bg-white/[0.02] blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm px-4">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center gap-4">
          <div className="relative">
            <img
              src={orbitIcon}
              alt="OrbitCI"
              className="h-20 w-20 rounded-2xl object-cover shadow-2xl"
              style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}
            />
          </div>
          <div className="text-center">
            <h1 className="text-[26px] font-bold tracking-tight">OrbitCI</h1>
            <p className="text-muted-foreground mt-1 text-[13px]">
              GitHub Actions runner local com interface gráfica
            </p>
          </div>
        </div>

        <Card className="border-border/50 shadow-2xl">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <Key className="h-4 w-4 text-primary" />
              Personal Access Token
            </CardTitle>
            <CardDescription className="text-[13px]">
              Entre com um PAT do GitHub para usar o OrbitCI
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token" className="text-[13px]">Token</Label>
              <Input
                id="token"
                type="password"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                className="font-mono text-[13px]"
                autoFocus
              />
            </div>

            {/* Required scopes */}
            <div className="rounded-md border border-border/50 bg-muted/30 p-3 space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Escopos necessários
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {scopes.map((scope) => (
                  <div key={scope} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <CheckCircle2 className="h-3 w-3 text-[#3fb950] shrink-0" />
                    <code className="text-foreground">{scope}</code>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-3">
            <Button
              className="w-full h-9 text-[13px]"
              onClick={handleLogin}
              disabled={!token.trim() || isLoading}
            >
              {isLoading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Autenticando...</>
              ) : (
                <><Key className="h-4 w-4" /> Entrar com Token</>
              )}
            </Button>

            <a
              href="https://github.com/settings/tokens/new?scopes=repo,workflow,read:user,user:email&description=OrbitCI"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-primary transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              Criar novo token no GitHub
            </a>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
