import type { ActionHandler } from './index'
import {
  writeFileSync,
  readFileSync,
  copyFileSync,
  unlinkSync,
  mkdirSync,
  existsSync
} from 'fs'
import { join, dirname } from 'path'
import Handlebars from 'handlebars'

export const fileActions: Record<string, ActionHandler> = {
  'file/write': async ({ with: w, workspace, log }) => {
    if (!w?.path) throw new Error('file/write: "path" é obrigatório')
    const filePath = join(workspace, w.path)
    mkdirSync(dirname(filePath), { recursive: true })
    const mode = w?.mode ?? 'overwrite'
    const content = w?.content ?? ''
    if (mode === 'append' && existsSync(filePath)) {
      const existing = readFileSync(filePath, 'utf-8')
      writeFileSync(filePath, existing + '\n' + content, 'utf-8')
    } else {
      writeFileSync(filePath, content, 'utf-8')
    }
    log(`[OK] Arquivo escrito: ${w.path}`)
  },

  'file/delete': async ({ with: w, workspace, log }) => {
    if (!w?.path) throw new Error('file/delete: "path" é obrigatório')
    const filePath = join(workspace, w.path)
    if (existsSync(filePath)) {
      unlinkSync(filePath)
      log(`[OK] Arquivo removido: ${w.path}`)
    } else {
      log(`[WARN] Arquivo nao encontrado: ${w.path}`)
    }
  },

  'file/copy': async ({ with: w, workspace, log }) => {
    if (!w?.source || !w?.destination) {
      throw new Error('file/copy: "source" e "destination" são obrigatórios')
    }
    const src = join(workspace, w.source)
    const dst = join(workspace, w.destination)
    mkdirSync(dirname(dst), { recursive: true })
    copyFileSync(src, dst)
    log(`[OK] Arquivo copiado: ${w.source} -> ${w.destination}`)
  },

  'file/mkdir': async ({ with: w, workspace, log }) => {
    if (!w?.path) throw new Error('file/mkdir: "path" é obrigatório')
    const dir = join(workspace, w.path)
    mkdirSync(dir, { recursive: true })
    log(`[OK] Diretorio criado: ${w.path}`)
  },

  'file/template': async ({ with: w, workspace, log }) => {
    if (!w?.template || !w?.output) {
      throw new Error('file/template: "template" e "output" são obrigatórios')
    }
    const templatePath = join(workspace, w.template)
    const outputPath = join(workspace, w.output)
    const templateContent = readFileSync(templatePath, 'utf-8')
    const vars = w?.vars ? JSON.parse(w.vars) : {}
    const compiled = Handlebars.compile(templateContent)
    const result = compiled(vars)
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, result, 'utf-8')
    log(`[OK] Template renderizado: ${w.output}`)
  }
}
