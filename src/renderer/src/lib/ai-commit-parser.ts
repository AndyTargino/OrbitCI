export interface DiffParseOptions {
    maxTokens?: number
}

// Extensões de arquivos em que a IA jamais deve perder tempo analisando o miolo (apenas reportar que alterou)
const IGNORE_EXTENSIONS = new Set([
    'lock', 'map', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp',
    'pdf', 'mp4', 'mp3', 'woff', 'woff2', 'ttf', 'eot', 'otf',
    'zip', 'tar', 'gz', 'rar', '7z', 'exe', 'dll', 'so', 'dylib'
])

const IGNORE_FILES = new Set([
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
    'Cargo.lock', 'Gemfile.lock', 'composer.lock', 'mix.lock', 'poetry.lock'
])

function shouldIgnoreContent(filename: string): boolean {
    if (IGNORE_FILES.has(filename)) return true
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    return IGNORE_EXTENSIONS.has(ext)
}

/**
 * Traduz um Git Diff cru em uma estrutura de texto altamente otimizada para Modelos de IA.
 * 
 * Remove:
 * - Cabeçalhos do Git (index, a/, b/)
 * - Linhas de contexto inalteradas (dependendo do caso)
 * - Miolo de arquivos de lock/imagem
 * 
 * Reduz em até 60% o consumo de tokens.
 */
export function optimizeDiffForAI(rawDiff: string, stagedFiles: { path: string }[] = [], options?: DiffParseOptions): string {
    const maxChars = options?.maxTokens || 12000 // Limite de Segurança da janela

    if (!rawDiff || rawDiff.trim() === '') return 'No changes.'

    // Se o Diff cru for absurdamente gigante no Staged,
    // nem tentamos processar linha a linha, vamos pro fallback de Nomes de Arquivos
    if (rawDiff.length > 50000) {
        return generateFallbackStaged(stagedFiles, 'A diff is too huge to parse realistically.')
    }

    const lines = rawDiff.split('\n')
    const optimizedLines: string[] = []

    let currentFile = ''
    let ignoringCurrent = false

    for (const line of lines) {
        if (line.startsWith('diff --git')) {
            // Ex: diff --git a/src/main/ipc/repos.ts b/src/main/ipc/repos.ts
            const parts = line.split(' b/')
            if (parts.length === 2) {
                currentFile = parts[1]
            } else {
                currentFile = 'Unknown File'
            }

            ignoringCurrent = shouldIgnoreContent(currentFile)

            optimizedLines.push(`\nFile: /${currentFile}`)
            if (ignoringCurrent) {
                optimizedLines.push('[CONTENT IGNORED: Binary or Lockfile]')
            } else {
                optimizedLines.push('[MODIFICATIONS]')
            }
            continue
        }

        if (ignoringCurrent) continue

        // Filtra cabeçalhos inúteis
        if (line.startsWith('index ') ||
            line.startsWith('--- ') ||
            line.startsWith('+++ ') ||
            line.startsWith('@@ ') ||
            line === '\\ No newline at end of file') {
            continue
        }

        // Só importa o que entrou e o que saiu
        if (line.startsWith('+')) {
            const content = line.substring(1).trim()
            if (content) optimizedLines.push(`+ Added: ${content}`)
        } else if (line.startsWith('-')) {
            const content = line.substring(1).trim()
            if (content) optimizedLines.push(`- Removed: ${content}`)
        }
    }

    let finalOutput = optimizedLines.join('\n').trim()

    // Se a limpeza ainda deixou enorme (Ex: json gigante adicionado)
    if (finalOutput.length > maxChars) {
        return generateFallbackStaged(stagedFiles, `Diff still too large after optimization (Length: ${finalOutput.length}).`)
    }

    return finalOutput
}

function generateFallbackStaged(stagedFiles: { path: string }[], reason: string): string {
    const fileList = stagedFiles.map(f => `- ${f.path}`).join('\n')
    return `[FALLBACK MODE: ${reason}]\nProvide a generic commit message noting the alteration of the following files:\n${fileList}`
}
