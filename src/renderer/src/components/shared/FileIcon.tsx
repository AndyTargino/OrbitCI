import { type CSSProperties } from 'react'

// ── Extension → icon + color mapping ─────────────────────────────────────────
// Inspired by VSCode Seti/Material icon themes

interface FileIconDef {
  color: string
  /** SVG path(s) rendered inside a 16x16 viewBox */
  paths: string[]
}

// SVG path constants for different file type shapes
const PATHS = {
  // Generic code file (angle brackets)
  code: ['M5 3l-4 5 4 5M11 3l4 5-4 5'],
  // Braces { }
  braces: ['M5 2C3.5 2 3 3 3 4v2.5C3 7.5 2 8 2 8s1 .5 1 1.5V12c0 1 .5 2 2 2M11 2c1.5 0 2 1 2 2v2.5c0 1 1 1.5 1 1.5s-1 .5-1 1.5V12c0 1-.5 2-2 2'],
  // Config/gear
  gear: ['M8 10a2 2 0 100-4 2 2 0 000 4zM8 1l1 2h2l1.5 1.5-1 1.7L13 8l-1.5 1.8 1 1.7L11 13H9l-1 2-1-2H5l-1.5-1.5 1-1.7L3 8l1.5-1.8-1-1.7L5 3h2l1-2z'],
  // Document/text
  doc: ['M4 1h5l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1zm4.5 0v4.5H13', 'M5 8h6M5 10h6M5 12h4'],
  // Image
  image: ['M2 3h12a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V4a1 1 0 011-1z', 'M5 7a1 1 0 100-2 1 1 0 000 2z', 'M15 11l-3.5-4L8 11l-2.5-2L1 13'],
  // Style/palette
  style: ['M2 2h12v12H2zM2 5h12M5 5v9'],
  // Data/table
  data: ['M2 2h12a1 1 0 011 1v10a1 1 0 01-1 1H2a1 1 0 01-1-1V3a1 1 0 011-1z', 'M1 5h14M1 8h14M1 11h14M6 5v9M10 5v9'],
  // Terminal/console
  terminal: ['M2 3h12a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V4a1 1 0 011-1z', 'M4 7l2.5 2L4 11M8 11h3'],
  // Markdown
  markdown: ['M2 3h12a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V4a1 1 0 011-1z', 'M4 11V5l2.5 3L9 5v6M11 8.5l1.5 2 1.5-2M11 8.5v-3M14 8.5v-3'],
  // Lock
  lock: ['M4 7h8v6a1 1 0 01-1 1H5a1 1 0 01-1-1V7zM5.5 7V5a2.5 2.5 0 015 0v2', 'M8 10v1.5'],
  // Package/box
  pkg: ['M1 4.5l7-3.5 7 3.5v7l-7 3.5-7-3.5z', 'M1 4.5L8 8l7-3.5M8 8v7.5'],
  // Database/cylinder
  db: ['M3 3c0-1.1 2.2-2 5-2s5 .9 5 2v10c0 1.1-2.2 2-5 2s-5-.9-5-2V3z', 'M3 3c0 1.1 2.2 2 5 2s5-.9 5-2', 'M3 7c0 1.1 2.2 2 5 2s5-.9 5-2', 'M3 11c0 1.1 2.2 2 5 2s5-.9 5-2'],
  // Test/check
  test: ['M2 3h12v12H2z', 'M5 8l2 2 4-4'],
  // Font
  font: ['M3 13L8 2l5 11M4.5 10h7'],
  // Video/film
  video: ['M2 3h12a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V4a1 1 0 011-1z', 'M6 3v10M10 3v10M1 6h4M11 6h4M1 10h4M11 10h4'],
  // Audio/music
  audio: ['M3 12V6l8-3v9', 'M3 12a2 2 0 11-2-2 2 2 0 012 2z', 'M11 12a2 2 0 11-2-2 2 2 0 012 2z'],
  // Key/env
  key: ['M8 1a4 4 0 00-3.46 6L1 10.54V14h3.46v-1.5H6V11h1.54l.92-.92A4 4 0 008 1zm1 3a1 1 0 110-2 1 1 0 010 2z'],
  // React atom
  react: ['M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z', 'M8 5C5.5 5 1 5.8 1 8s4.5 3 7 3 7-.8 7-3-4.5-3-7-3z', 'M5.6 6.5C4.4 4.4 3 .8 5.2-.4s5.5 3.2 6.7 5.3 2.7 6.8.5 8-5.5-3.2-6.8-5.4z', 'M10.4 6.5c1.2-2.1 2.6-5.7.4-6.9s-5.5 3.2-6.7 5.3S1.4 11.7 3.6 12.9s5.5-3.2 6.8-5.4z'],
  // Generic file
  file: ['M4 1h5l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1zm4.5 0v4.5H13'],
  // Folder
  folder: ['M1 4v9a1 1 0 001 1h12a1 1 0 001-1V6a1 1 0 00-1-1H7.5L6 3H2a1 1 0 00-1 1z'],
  // Folder open
  folderOpen: ['M1 4v2h13a1 1 0 011 1v6a1 1 0 01-1 1H2a1 1 0 01-1-1V4a1 1 0 011-1h4l1.5 2H14a1 1 0 011 1v1'],
}

// ── Comprehensive file type definitions ──────────────────────────────────────

const FILE_ICONS: Record<string, FileIconDef> = {
  // TypeScript
  ts:       { color: '#3178c6', paths: PATHS.code },
  tsx:      { color: '#3178c6', paths: PATHS.react },
  mts:      { color: '#3178c6', paths: PATHS.code },
  cts:      { color: '#3178c6', paths: PATHS.code },
  'd.ts':   { color: '#3178c6', paths: PATHS.code },

  // JavaScript
  js:       { color: '#f1e05a', paths: PATHS.code },
  jsx:      { color: '#f1e05a', paths: PATHS.react },
  mjs:      { color: '#f1e05a', paths: PATHS.code },
  cjs:      { color: '#f1e05a', paths: PATHS.code },

  // Web
  html:     { color: '#e34c26', paths: PATHS.code },
  htm:      { color: '#e34c26', paths: PATHS.code },
  css:      { color: '#563d7c', paths: PATHS.style },
  scss:     { color: '#c6538c', paths: PATHS.style },
  sass:     { color: '#c6538c', paths: PATHS.style },
  less:     { color: '#1d365d', paths: PATHS.style },
  styl:     { color: '#ff6347', paths: PATHS.style },
  stylus:   { color: '#ff6347', paths: PATHS.style },

  // Frameworks
  vue:      { color: '#41b883', paths: PATHS.code },
  svelte:   { color: '#ff3e00', paths: PATHS.code },
  astro:    { color: '#ff5d01', paths: PATHS.code },
  angular:  { color: '#dd0031', paths: PATHS.code },

  // Data / Config
  json:     { color: '#f1e05a', paths: PATHS.braces },
  jsonc:    { color: '#f1e05a', paths: PATHS.braces },
  json5:    { color: '#f1e05a', paths: PATHS.braces },
  yaml:     { color: '#cb171e', paths: PATHS.gear },
  yml:      { color: '#cb171e', paths: PATHS.gear },
  toml:     { color: '#9c4121', paths: PATHS.gear },
  ini:      { color: '#6a737d', paths: PATHS.gear },
  xml:      { color: '#e34c26', paths: PATHS.code },
  csv:      { color: '#237346', paths: PATHS.data },
  tsv:      { color: '#237346', paths: PATHS.data },

  // Markdown / Docs
  md:       { color: '#519aba', paths: PATHS.markdown },
  mdx:      { color: '#519aba', paths: PATHS.markdown },
  rst:      { color: '#141414', paths: PATHS.doc },
  txt:      { color: '#8b949e', paths: PATHS.doc },
  rtf:      { color: '#8b949e', paths: PATHS.doc },
  pdf:      { color: '#e34c26', paths: PATHS.doc },
  tex:      { color: '#3D6117', paths: PATHS.doc },

  // Images
  svg:      { color: '#ffb13b', paths: PATHS.image },
  png:      { color: '#a074c4', paths: PATHS.image },
  jpg:      { color: '#a074c4', paths: PATHS.image },
  jpeg:     { color: '#a074c4', paths: PATHS.image },
  gif:      { color: '#a074c4', paths: PATHS.image },
  ico:      { color: '#a074c4', paths: PATHS.image },
  webp:     { color: '#a074c4', paths: PATHS.image },
  bmp:      { color: '#a074c4', paths: PATHS.image },
  avif:     { color: '#a074c4', paths: PATHS.image },

  // Fonts
  woff:     { color: '#e34c26', paths: PATHS.font },
  woff2:    { color: '#e34c26', paths: PATHS.font },
  ttf:      { color: '#e34c26', paths: PATHS.font },
  otf:      { color: '#e34c26', paths: PATHS.font },
  eot:      { color: '#e34c26', paths: PATHS.font },

  // Video
  mp4:      { color: '#8b6cc4', paths: PATHS.video },
  webm:     { color: '#8b6cc4', paths: PATHS.video },
  mkv:      { color: '#8b6cc4', paths: PATHS.video },
  avi:      { color: '#8b6cc4', paths: PATHS.video },
  mov:      { color: '#8b6cc4', paths: PATHS.video },

  // Audio
  mp3:      { color: '#e91e63', paths: PATHS.audio },
  wav:      { color: '#e91e63', paths: PATHS.audio },
  ogg:      { color: '#e91e63', paths: PATHS.audio },
  flac:     { color: '#e91e63', paths: PATHS.audio },

  // Shell / Scripts
  sh:       { color: '#89e051', paths: PATHS.terminal },
  bash:     { color: '#89e051', paths: PATHS.terminal },
  zsh:      { color: '#89e051', paths: PATHS.terminal },
  fish:     { color: '#89e051', paths: PATHS.terminal },
  ps1:      { color: '#012456', paths: PATHS.terminal },
  bat:      { color: '#c1f12e', paths: PATHS.terminal },
  cmd:      { color: '#c1f12e', paths: PATHS.terminal },

  // Python
  py:       { color: '#3572a5', paths: PATHS.code },
  pyx:      { color: '#3572a5', paths: PATHS.code },
  pyi:      { color: '#3572a5', paths: PATHS.code },
  ipynb:    { color: '#da5b0b', paths: PATHS.data },

  // Go
  go:       { color: '#00add8', paths: PATHS.code },
  mod:      { color: '#00add8', paths: PATHS.gear },
  sum:      { color: '#00add8', paths: PATHS.lock },

  // Rust
  rs:       { color: '#dea584', paths: PATHS.code },

  // Ruby
  rb:       { color: '#701516', paths: PATHS.code },
  erb:      { color: '#701516', paths: PATHS.code },
  gemspec:  { color: '#701516', paths: PATHS.gear },

  // Java / JVM
  java:     { color: '#b07219', paths: PATHS.code },
  kt:       { color: '#A97BFF', paths: PATHS.code },
  kts:      { color: '#A97BFF', paths: PATHS.code },
  scala:    { color: '#c22d40', paths: PATHS.code },
  groovy:   { color: '#4298b8', paths: PATHS.code },
  gradle:   { color: '#02303a', paths: PATHS.gear },
  jar:      { color: '#b07219', paths: PATHS.pkg },

  // C / C++
  c:        { color: '#555555', paths: PATHS.code },
  h:        { color: '#555555', paths: PATHS.code },
  cpp:      { color: '#f34b7d', paths: PATHS.code },
  hpp:      { color: '#f34b7d', paths: PATHS.code },
  cc:       { color: '#f34b7d', paths: PATHS.code },

  // C#
  cs:       { color: '#178600', paths: PATHS.code },
  csproj:   { color: '#178600', paths: PATHS.gear },

  // Swift / Objective-C
  swift:    { color: '#F05138', paths: PATHS.code },
  m:        { color: '#438eff', paths: PATHS.code },

  // PHP
  php:      { color: '#4F5D95', paths: PATHS.code },

  // Dart / Flutter
  dart:     { color: '#00B4AB', paths: PATHS.code },

  // Elixir / Erlang
  ex:       { color: '#6e4a7e', paths: PATHS.code },
  exs:      { color: '#6e4a7e', paths: PATHS.code },
  erl:      { color: '#B83998', paths: PATHS.code },

  // Haskell
  hs:       { color: '#5e5086', paths: PATHS.code },

  // Lua
  lua:      { color: '#000080', paths: PATHS.code },

  // R
  r:        { color: '#198CE7', paths: PATHS.code },
  rmd:      { color: '#198CE7', paths: PATHS.markdown },

  // SQL / Database
  sql:      { color: '#e38c00', paths: PATHS.db },
  sqlite:   { color: '#e38c00', paths: PATHS.db },
  prisma:   { color: '#2D3748', paths: PATHS.db },

  // Docker
  dockerfile: { color: '#384d54', paths: PATHS.pkg },

  // Lock files
  lock:     { color: '#6a737d', paths: PATHS.lock },

  // Environment
  env:      { color: '#ecd53f', paths: PATHS.key },

  // Config files
  editorconfig: { color: '#6a737d', paths: PATHS.gear },
  eslintrc:     { color: '#4b32c3', paths: PATHS.gear },
  prettierrc:   { color: '#56b3b4', paths: PATHS.gear },
  babelrc:      { color: '#f5da55', paths: PATHS.gear },
  browserslistrc: { color: '#ffd539', paths: PATHS.gear },

  // Testing
  spec:     { color: '#22b14c', paths: PATHS.test },
  test:     { color: '#22b14c', paths: PATHS.test },

  // Package managers
  npmrc:    { color: '#cb3837', paths: PATHS.gear },

  // GraphQL
  graphql:  { color: '#e10098', paths: PATHS.code },
  gql:      { color: '#e10098', paths: PATHS.code },

  // Protobuf
  proto:    { color: '#6a737d', paths: PATHS.code },

  // WASM
  wasm:     { color: '#654ff0', paths: PATHS.code },
  wat:      { color: '#654ff0', paths: PATHS.code },

  // Zig
  zig:      { color: '#ec915c', paths: PATHS.code },

  // Nim
  nim:      { color: '#ffc200', paths: PATHS.code },

  // V
  v:        { color: '#5d87bf', paths: PATHS.code },

  // Log
  log:      { color: '#6a737d', paths: PATHS.doc },

  // Archives
  zip:      { color: '#6a737d', paths: PATHS.pkg },
  tar:      { color: '#6a737d', paths: PATHS.pkg },
  gz:       { color: '#6a737d', paths: PATHS.pkg },
  '7z':     { color: '#6a737d', paths: PATHS.pkg },
  rar:      { color: '#6a737d', paths: PATHS.pkg },

  // Misc
  map:      { color: '#6a737d', paths: PATHS.braces },
}

// Special full-filename matches (take priority over extension)
const FILENAME_ICONS: Record<string, FileIconDef> = {
  'dockerfile':       { color: '#384d54', paths: PATHS.pkg },
  'docker-compose.yml': { color: '#384d54', paths: PATHS.pkg },
  'docker-compose.yaml': { color: '#384d54', paths: PATHS.pkg },
  'makefile':         { color: '#6a737d', paths: PATHS.terminal },
  'cmakelists.txt':   { color: '#6a737d', paths: PATHS.gear },
  'license':          { color: '#d4c066', paths: PATHS.doc },
  'license.md':       { color: '#d4c066', paths: PATHS.doc },
  'readme.md':        { color: '#519aba', paths: PATHS.markdown },
  'changelog.md':     { color: '#519aba', paths: PATHS.markdown },
  '.gitignore':       { color: '#f54d27', paths: PATHS.gear },
  '.gitattributes':   { color: '#f54d27', paths: PATHS.gear },
  '.gitmodules':      { color: '#f54d27', paths: PATHS.gear },
  '.env':             { color: '#ecd53f', paths: PATHS.key },
  '.env.local':       { color: '#ecd53f', paths: PATHS.key },
  '.env.development': { color: '#ecd53f', paths: PATHS.key },
  '.env.production':  { color: '#ecd53f', paths: PATHS.key },
  '.env.test':        { color: '#ecd53f', paths: PATHS.key },
  '.npmrc':           { color: '#cb3837', paths: PATHS.gear },
  '.nvmrc':           { color: '#3c873a', paths: PATHS.gear },
  '.editorconfig':    { color: '#6a737d', paths: PATHS.gear },
  '.eslintrc':        { color: '#4b32c3', paths: PATHS.gear },
  '.eslintrc.js':     { color: '#4b32c3', paths: PATHS.gear },
  '.eslintrc.json':   { color: '#4b32c3', paths: PATHS.gear },
  '.prettierrc':      { color: '#56b3b4', paths: PATHS.gear },
  '.prettierrc.js':   { color: '#56b3b4', paths: PATHS.gear },
  '.prettierrc.json': { color: '#56b3b4', paths: PATHS.gear },
  '.babelrc':         { color: '#f5da55', paths: PATHS.gear },
  'tsconfig.json':    { color: '#3178c6', paths: PATHS.gear },
  'tsconfig.node.json': { color: '#3178c6', paths: PATHS.gear },
  'tsconfig.web.json': { color: '#3178c6', paths: PATHS.gear },
  'package.json':     { color: '#3c873a', paths: PATHS.braces },
  'package-lock.json': { color: '#3c873a', paths: PATHS.lock },
  'yarn.lock':        { color: '#2c8ebb', paths: PATHS.lock },
  'pnpm-lock.yaml':   { color: '#f69220', paths: PATHS.lock },
  'bun.lockb':        { color: '#fbf0df', paths: PATHS.lock },
  'vite.config.ts':   { color: '#646cff', paths: PATHS.gear },
  'vite.config.js':   { color: '#646cff', paths: PATHS.gear },
  'tailwind.config.js': { color: '#06b6d4', paths: PATHS.gear },
  'tailwind.config.ts': { color: '#06b6d4', paths: PATHS.gear },
  'postcss.config.js':  { color: '#dd3a0a', paths: PATHS.gear },
  'postcss.config.ts':  { color: '#dd3a0a', paths: PATHS.gear },
  'webpack.config.js':  { color: '#8dd6f9', paths: PATHS.gear },
  'jest.config.js':     { color: '#99425b', paths: PATHS.test },
  'jest.config.ts':     { color: '#99425b', paths: PATHS.test },
  'vitest.config.ts':   { color: '#729b1b', paths: PATHS.test },
  'vitest.config.js':   { color: '#729b1b', paths: PATHS.test },
  'rollup.config.js':   { color: '#ec4a3f', paths: PATHS.gear },
  'rollup.config.ts':   { color: '#ec4a3f', paths: PATHS.gear },
  'cargo.toml':         { color: '#dea584', paths: PATHS.gear },
  'cargo.lock':         { color: '#dea584', paths: PATHS.lock },
  'go.mod':             { color: '#00add8', paths: PATHS.gear },
  'go.sum':             { color: '#00add8', paths: PATHS.lock },
  'gemfile':            { color: '#701516', paths: PATHS.gear },
  'gemfile.lock':       { color: '#701516', paths: PATHS.lock },
  'requirements.txt':   { color: '#3572a5', paths: PATHS.doc },
  'pipfile':            { color: '#3572a5', paths: PATHS.gear },
  'pipfile.lock':       { color: '#3572a5', paths: PATHS.lock },
  'pyproject.toml':     { color: '#3572a5', paths: PATHS.gear },
}

const DEFAULT_ICON: FileIconDef = { color: '#8b949e', paths: PATHS.file }
const FOLDER_ICON: FileIconDef = { color: '#8b949e', paths: PATHS.folder }
const FOLDER_OPEN_ICON: FileIconDef = { color: '#c09553', paths: PATHS.folderOpen }

function resolveIcon(filename: string, isFolder?: boolean, isOpen?: boolean): FileIconDef {
  if (isFolder) return isOpen ? FOLDER_OPEN_ICON : FOLDER_ICON

  const lower = filename.toLowerCase()
  const baseName = lower.includes('/') ? lower.slice(lower.lastIndexOf('/') + 1) : lower
  const baseNameWin = baseName.includes('\\') ? baseName.slice(baseName.lastIndexOf('\\') + 1) : baseName

  // Check full filename match first
  const byName = FILENAME_ICONS[baseNameWin]
  if (byName) return byName

  // Check compound extensions (e.g. .d.ts, .spec.ts, .test.js)
  const parts = baseNameWin.split('.')
  if (parts.length >= 3) {
    const compoundExt = parts.slice(-2).join('.')
    const byCompound = FILE_ICONS[compoundExt]
    if (byCompound) return byCompound

    // Check for .spec. / .test. pattern
    const secondLast = parts[parts.length - 2]
    if (secondLast === 'spec' || secondLast === 'test') {
      return { color: '#22b14c', paths: PATHS.test }
    }
  }

  // Simple extension match
  const ext = parts.pop() ?? ''
  const byExt = FILE_ICONS[ext]
  if (byExt) return byExt

  return DEFAULT_ICON
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getFileIconColor(filename: string): string {
  return resolveIcon(filename).color
}

interface FileIconProps {
  filename: string
  isFolder?: boolean
  isOpen?: boolean
  className?: string
  size?: number
  style?: CSSProperties
}

export function FileIcon({
  filename,
  isFolder,
  isOpen,
  className,
  size = 16,
  style
}: FileIconProps): JSX.Element {
  const icon = resolveIcon(filename, isFolder, isOpen)

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke={icon.color}
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
    >
      {icon.paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}
