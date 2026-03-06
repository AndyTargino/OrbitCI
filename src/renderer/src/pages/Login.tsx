import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Key, Loader2, ExternalLink, CheckCircle2, Github, Save, Copy, ArrowRight
} from 'lucide-react'
import { electron } from '@/lib/electron'
import orbitIcon from '@/assets/icon_dark.png'
import { useAuthStore, useRepoStore, useSettingsStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { IPC_CHANNELS } from '@shared/constants'
import type { GitHubUser } from '@shared/types'

type Tab = 'github' | 'token'

export function Login(): JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { setUser } = useAuthStore()
  const { setRepos } = useRepoStore()
  const { setSettings } = useSettingsStore()

  const [activeTab, setActiveTab] = useState<Tab>('github')
  const [token, setToken] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // OAuth state
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [hasOAuthCreds, setHasOAuthCreds] = useState(false)
  const [isLoadingSettings, setIsLoadingSettings] = useState(true)
  const [isSavingCreds, setIsSavingCreds] = useState(false)
  const [isWaitingOAuth, setIsWaitingOAuth] = useState(false)

  // Load settings to check for existing OAuth credentials
  useEffect(() => {
    electron.settings.get().then((settings) => {
      if (settings.githubClientId && settings.githubClientSecret) {
        setClientId(settings.githubClientId)
        setClientSecret(settings.githubClientSecret)
        setHasOAuthCreds(true)
      }
    }).catch(() => {}).finally(() => setIsLoadingSettings(false))
  }, [])

  // Listen for OAuth callback from main process
  useEffect(() => {
    const unsub = electron.on(
      IPC_CHANNELS.EVENT_OAUTH_CALLBACK,
      async (data: unknown) => {
        const result = data as { success: boolean; user?: GitHubUser; error?: string }

        if (result.success && result.user) {
          setUser(result.user)
          try {
            const [repos, settings] = await Promise.all([
              electron.repos.list(),
              electron.settings.get()
            ])
            setRepos(repos)
            setSettings(settings)
          } catch { /* continue anyway */ }
          notify('success', t('login.notifications.login_success'), t('login.notifications.welcome', { name: result.user.name ?? result.user.login }))
          navigate('/')
        } else {
          notify('failure', t('login.notifications.oauth_error'), result.error ?? t('common.error_unknown'))
        }
        setIsWaitingOAuth(false)
      }
    )

    return unsub
  }, [navigate, setUser, setRepos, setSettings, t])

  // PAT login
  const handleTokenLogin = async () => {
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
      navigate('/')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('login.notifications.invalid_token')
      notify('failure', t('login.notifications.auth_error'), msg)
    } finally {
      setIsLoading(false)
    }
  }

  // Save OAuth credentials
  const handleSaveOAuthCreds = async () => {
    if (!clientId.trim() || !clientSecret.trim()) return
    setIsSavingCreds(true)
    try {
      await electron.settings.update({
        githubClientId: clientId.trim(),
        githubClientSecret: clientSecret.trim()
      })
      setHasOAuthCreds(true)
      notify('success', t('login.notifications.creds_saved'), t('login.notifications.click_login'))
    } catch (err: unknown) {
      notify('failure', t('login.notifications.save_error'), err instanceof Error ? err.message : t('common.error'))
    } finally {
      setIsSavingCreds(false)
    }
  }

  // Start OAuth flow
  const handleOAuthLogin = async () => {
    setIsWaitingOAuth(true)
    try {
      await electron.auth.githubOAuthStart(clientId, clientSecret)
    } catch (err: unknown) {
      notify('failure', t('login.notifications.oauth_start_error'), err instanceof Error ? err.message : t('common.error'))
      setIsWaitingOAuth(false)
    }
  }

  const handleCopyCallback = () => {
    navigator.clipboard.writeText('orbitci://callback')
    notify('success', t('common.copied'), 'orbitci://callback')
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
              {t('login.brand_subtitle', 'Local GitHub Actions runner with desktop GUI')}
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 mb-3 bg-card/50 rounded-lg p-1 border border-border/50">
          {([
            { key: 'github' as Tab, label: 'GitHub', icon: Github },
            { key: 'token' as Tab, label: t('login.tabs.token', 'Token (PAT)'), icon: Key }
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2 px-3 text-[13px] rounded-md transition-all',
                activeTab === key
                  ? 'bg-primary text-primary-foreground font-medium shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* GitHub OAuth tab */}
        {activeTab === 'github' && (
          <Card className="border-border/50 shadow-2xl">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-[15px]">
                <Github className="h-4 w-4 text-primary" />
                {t('login.oauth.title', 'Login with GitHub')}
              </CardTitle>
              <CardDescription className="text-[13px]">
                {t('login.oauth.description', 'Authorize via browser — no token copying needed')}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {isLoadingSettings ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : hasOAuthCreds ? (
                /* OAuth credentials configured — show login button */
                <div className="space-y-4">
                  {isWaitingOAuth ? (
                    <div className="text-center py-4 space-y-3">
                      <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                      <div>
                        <p className="text-[13px] font-medium">{t('login.oauth.waiting', 'Waiting for authorization...')}</p>
                        <p className="text-[12px] text-muted-foreground mt-1">
                          {t('login.oauth.complete_help', 'Complete authorization in your browser')}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-[12px]"
                        onClick={() => setIsWaitingOAuth(false)}
                      >
                        {t('common.cancel', 'Cancel')}
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Button
                        className="w-full h-10 text-[14px] gap-2"
                        onClick={handleOAuthLogin}
                      >
                        <Github className="h-4.5 w-4.5" />
                        {t('login.oauth.login_btn', 'Login with GitHub')}
                      </Button>

                      {/* Scopes info */}
                      <div className="rounded-md border border-border/50 bg-muted/30 p-3 space-y-2">
                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                          {t('login.oauth.permissions', 'Requested permissions')}
                        </p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {scopes.map((scope) => (
                            <div key={scope} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                              <CheckCircle2 className="h-3 w-3 text-[#4ade80] shrink-0" />
                              <code className="text-foreground">{scope}</code>
                            </div>
                          ))}
                        </div>
                      </div>

                      <button
                        onClick={() => setHasOAuthCreds(false)}
                        className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {t('login.oauth.change_creds', 'Change OAuth credentials')}
                      </button>
                    </>
                  )}
                </div>
              ) : (
                /* No OAuth credentials — show setup form */
                <div className="space-y-4">
                  <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-2">
                    <p className="text-[13px] font-medium text-foreground">{t('login.setup.title', 'Initial Setup')}</p>
                    <p className="text-[12px] text-muted-foreground leading-relaxed">
                      {t('login.setup.description', 'Create an OAuth App on GitHub to enable login. You only need to do this once.')}
                    </p>
                    <a
                      href="https://github.com/settings/developers"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[12px] text-primary hover:underline font-medium"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {t('login.setup.open_settings', 'Open GitHub Developer Settings')}
                    </a>
                  </div>

                  {/* Step-by-step */}
                  <div className="space-y-2.5 text-[12px]">
                    <div className="flex gap-2">
                      <span className="shrink-0 h-5 w-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center">1</span>
                      <span className="text-muted-foreground pt-0.5">
                        {t('login.setup.step1', { strong: 'New OAuth App', defaultValue: 'Click on <strong>New OAuth App</strong>' })}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <span className="shrink-0 h-5 w-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center">2</span>
                      <div className="pt-0.5">
                        <span className="text-muted-foreground">
                          {t('login.setup.step2', { strong: 'Authorization callback URL', defaultValue: 'In <strong>Authorization callback URL</strong>, paste:' })}
                        </span>
                        <button
                          onClick={handleCopyCallback}
                          className="mt-1 flex items-center gap-1.5 rounded border border-border bg-muted/50 px-2 py-1 font-mono text-[11px] text-foreground hover:bg-muted transition-colors"
                        >
                          <Copy className="h-3 w-3 text-muted-foreground" />
                          orbitci://callback
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <span className="shrink-0 h-5 w-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center">3</span>
                      <span className="text-muted-foreground pt-0.5">
                        {t('login.setup.step3', { strong1: 'Client ID', strong2: 'Client Secret', defaultValue: 'Copy <strong>Client ID</strong> and <strong>Client Secret</strong> below' })}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3 pt-1">
                    <div className="space-y-1.5">
                      <Label className="text-[12px]">{t('settings.oauth.client_id', 'Client ID')}</Label>
                      <Input
                        placeholder="Ov23liXXXXXXXXXXXXXX"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        className="font-mono text-[13px]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[12px]">{t('settings.oauth.client_secret', 'Client Secret')}</Label>
                      <Input
                        type="password"
                        placeholder="••••••••••••••••••••••••••••••••••••••••"
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                        className="font-mono text-[13px]"
                      />
                    </div>
                  </div>
                </div>
              )}
            </CardContent>

            {!isLoadingSettings && !hasOAuthCreds && (
              <CardFooter>
                <Button
                  className="w-full h-9 text-[13px]"
                  onClick={handleSaveOAuthCreds}
                  disabled={!clientId.trim() || !clientSecret.trim() || isSavingCreds}
                >
                  {isSavingCreds ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> {t('common.saving', 'Saving...')}</>
                  ) : (
                    <><ArrowRight className="h-4 w-4" /> {t('login.setup.save_continue', 'Save and continue')}</>
                  )}
                </Button>
              </CardFooter>
            )}
          </Card>
        )}

        {/* Token (PAT) tab */}
        {activeTab === 'token' && (
          <Card className="border-border/50 shadow-2xl">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-[15px]">
                <Key className="h-4 w-4 text-primary" />
                {t('login.pat.title', 'Personal Access Token')}
              </CardTitle>
              <CardDescription className="text-[13px]">
                {t('login.pat.description', 'Enter a GitHub PAT to use OrbitCI')}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="token" className="text-[13px]">{t('login.pat.token_label', 'Token')}</Label>
                <Input
                  id="token"
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTokenLogin()}
                  className="font-mono text-[13px]"
                  autoFocus={activeTab === 'token'}
                />
              </div>

              {/* Required scopes */}
              <div className="rounded-md border border-border/50 bg-muted/30 p-3 space-y-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {t('login.pat.scopes_label', 'Required scopes')}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {scopes.map((scope) => (
                    <div key={scope} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                      <CheckCircle2 className="h-3 w-3 text-[#4ade80] shrink-0" />
                      <code className="text-foreground">{scope}</code>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-3">
              <Button
                className="w-full h-9 text-[13px]"
                onClick={handleTokenLogin}
                disabled={!token.trim() || isLoading}
              >
                {isLoading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> {t('login.pat.authenticating', 'Authenticating...')}</>
                ) : (
                  <><Key className="h-4 w-4" /> {t('login.pat.login_btn', 'Login with Token')}</>
                )}
              </Button>

              <a
                href="https://github.com/settings/tokens/new?scopes=repo,workflow,read:user,user:email&description=OrbitCI"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-primary transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                {t('login.pat.create_token', 'Create new token on GitHub')}
              </a>
            </CardFooter>
          </Card>
        )}

        {/* Language switcher */}
        <div className="flex items-center justify-center gap-2 mt-6 text-[12px]">
          <button
            onClick={() => { i18n.changeLanguage('en'); electron.settings.update({ language: 'en' }) }}
            className={cn(
              'transition-colors',
              i18n.language === 'en' ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            English
          </button>
          <span className="text-muted-foreground/40">·</span>
          <button
            onClick={() => { i18n.changeLanguage('pt'); electron.settings.update({ language: 'pt' }) }}
            className={cn(
              'transition-colors',
              i18n.language === 'pt' ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Português
          </button>
        </div>
      </div>
    </div>
  )
}
