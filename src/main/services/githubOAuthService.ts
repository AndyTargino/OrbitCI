import axios from 'axios'
import { randomBytes } from 'crypto'

const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const REDIRECT_URI = 'orbitci://callback'
const OAUTH_SCOPES = 'repo workflow read:user user:email'

// ─── Pending state (CSRF protection) ──────────────────────────────────────────
interface PendingOAuth {
  state: string
  clientId: string
  clientSecret: string
}
let pendingOAuth: PendingOAuth | null = null

// ─── Build the authorization URL and store pending state ──────────────────────
export function startAuthCodeFlow(clientId: string, clientSecret: string): string {
  const state = randomBytes(16).toString('hex')
  pendingOAuth = { state, clientId, clientSecret }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: OAUTH_SCOPES,
    state
  })

  return `${AUTHORIZE_URL}?${params.toString()}`
}

// ─── Handle the orbitci://callback?code=...&state=... redirect ─────────────────
export async function handleOAuthCallback(
  callbackUrl: string
): Promise<{ token: string } | { error: string }> {
  let url: URL
  try {
    url = new URL(callbackUrl)
  } catch {
    pendingOAuth = null
    return { error: 'URL de callback inválida.' }
  }

  const error = url.searchParams.get('error')
  if (error) {
    pendingOAuth = null
    return {
      error:
        error === 'access_denied'
          ? 'Acesso negado. Você cancelou a autorização.'
          : `Erro GitHub: ${error}`
    }
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  if (!code || !state || !pendingOAuth || state !== pendingOAuth.state) {
    pendingOAuth = null
    return { error: 'Estado OAuth inválido. Tente novamente.' }
  }

  const { clientId, clientSecret } = pendingOAuth
  pendingOAuth = null

  try {
    const { data } = await axios.post(
      TOKEN_URL,
      {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: REDIRECT_URI
      },
      { headers: { Accept: 'application/json' } }
    )

    if (data.error) {
      return { error: data.error_description ?? data.error }
    }

    if (!data.access_token) {
      return { error: 'Token não retornado pelo GitHub.' }
    }

    return { token: data.access_token as string }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao trocar o código pelo token'
    return { error: msg }
  }
}

// ─── Cancel any pending OAuth flow ────────────────────────────────────────────
export function cancelOAuthFlow(): void {
  pendingOAuth = null
}
