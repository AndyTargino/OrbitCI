import type { ActionHandler } from './index'
import { showNotification } from '../../notification/manager'
import axios from 'axios'
import { execSync } from 'child_process'

export const utilActions: Record<string, ActionHandler> = {
  'notify/desktop': async ({ with: w, log }) => {
    const title = w?.title ?? 'OrbitCI'
    const body = w?.body ?? ''
    showNotification({ title, body })
    log(`✓ Notificação enviada: ${title}`)
  },

  'env/set': async ({ with: w, env, log }) => {
    if (!w) return
    for (const [key, val] of Object.entries(w)) {
      env[key] = String(val)
      log(`✓ env.${key} definido`)
    }
  },

  'http/request': async ({ with: w, log, setOutput }) => {
    const url = w?.url
    if (!url) throw new Error('http/request: "url" é obrigatório')
    const method = (w?.method ?? 'GET').toLowerCase()
    const headers = w?.headers ? JSON.parse(w.headers) : {}
    const body = w?.body

    const response = await axios({
      method,
      url,
      headers,
      data: body
    })

    log(`✓ ${method.toUpperCase()} ${url} → ${response.status}`)
    setOutput('status', String(response.status))
    setOutput('body', JSON.stringify(response.data))
    return { status: String(response.status), body: JSON.stringify(response.data) }
  },

  'npm/run': async ({ with: w, workspace, log }) => {
    const script = w?.script
    if (!script) throw new Error('npm/run: "script" é obrigatório')
    const args = w?.args ?? ''
    const cmd = `npm run ${script}${args ? ` -- ${args}` : ''}`
    const output = execSync(cmd, { cwd: workspace, encoding: 'utf-8' })
    log(output)
  },

  'docker/build': async ({ with: w, workspace, log }) => {
    const tag = w?.tag ?? 'orbit-build:latest'
    const file = w?.file ?? 'Dockerfile'
    const context = w?.context ?? '.'
    const cmd = `docker build -t ${tag} -f ${file} ${context}`
    const output = execSync(cmd, { cwd: workspace, encoding: 'utf-8' })
    log(output)
    log(`✓ Docker image built: ${tag}`)
  },

  'docker/push': async ({ with: w, workspace, log }) => {
    const image = w?.image
    if (!image) throw new Error('docker/push: "image" é obrigatório')
    const registry = w?.registry
    const fullImage = registry ? `${registry}/${image}` : image
    execSync(`docker push ${fullImage}`, { cwd: workspace, encoding: 'utf-8' })
    log(`✓ Docker image pushed: ${fullImage}`)
  }
}
