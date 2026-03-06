<p align="center">
  <img src="icon.png" alt="OrbitCI" width="128" height="128" />
</p>

<h1 align="center">OrbitCI</h1>

<p align="center">
  <strong>Run GitHub Actions locally. Zero cloud, full control.</strong>
</p>

<p align="center">
  <a href="https://github.com/AndyTargino/OrbitCI/releases/latest"><img src="https://img.shields.io/github/v/release/AndyTargino/OrbitCI?style=flat-square&color=8b5cf6" alt="Release" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square" alt="Platforms" />
  <img src="https://img.shields.io/badge/electron-29-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/open%20source-%E2%9C%93-8b5cf6?style=flat-square" alt="Open Source" />
</p>

---

OrbitCI is a free, open-source desktop application that lets you execute GitHub Actions-style workflows entirely on your local machine. No cloud runners, no usage limits, no waiting in queues. Clone your repos, write workflows in YAML, and run them with a single click.

**Tech Stack**: Electron 29 · React 18 · TypeScript · Drizzle ORM · SQLite · shadcn/ui · Zustand · simple-git · Octokit · Dockerode

## Why OrbitCI?

| Problem | OrbitCI Solution |
|---------|-----------------|
| GitHub Actions minutes are limited and expensive | Run unlimited workflows locally for free |
| Debugging CI pipelines requires push, wait, check logs cycles | Execute and debug workflows instantly on your machine |
| Secrets are managed in GitHub's UI with no local testing | Manage and test secrets locally before deploying |
| No visibility into resource usage during CI runs | Real-time CPU, RAM and GPU metrics per step |
| Docker-based workflows require complex local setup | One-click Docker integration with automatic installation |

## Features

### Workflow Execution
- **Local runner** that executes `.orbit/workflows/*.yml` files using the same YAML syntax as GitHub Actions
- **Expression engine** supporting `${{ }}` syntax: `github.*`, `secrets.*`, `steps.*.outputs.*`, `env.*`, `inputs.*`
- **Built-in actions** (`OrbitCI:` prefix): git operations, GitHub releases, file manipulation, versioning, Docker containers
- **Event triggers**: `push`, `release`, `schedule` (cron), `workflow_dispatch`
- **Release chain**: creating a release automatically triggers dependent `on: release` workflows
- **Job dependencies** via `needs:` with automatic skip on upstream failure
- **Conditional execution** with `if:` expressions, `continue-on-error`, and retry support
- **Live logs** streamed in real-time to the UI as each step executes

### Dashboard & Analytics
- **Datadog-inspired dashboard** with stat cards, sparklines, and activity charts
- **Interactive chart modes**: bar, line, and area views with hover tooltips
- **Source comparison**: side-by-side OrbitCI vs GitHub Actions performance metrics
- **Repository overview table** with success rates and inline progress bars
- **Unified run timeline** combining local and GitHub runs in one feed
- **Time-scoped filters**: today, 7 days, 30 days with automatic data refresh
- **Run history** with filtering by repo, status, source, and date range

### Repository Management
- **Clone** GitHub repositories directly from the app
- **Link** existing local folders to tracked repositories
- **Auto-detect** `.github/workflows/` and import them to `.orbit/workflows/`
- **Auto-sync** with configurable polling that detects new commits and triggers workflows automatically
- **GitHub release detection** that polls for new releases and fires `release` events locally

### Git Integration
- Full git panel: **stage, unstage, commit, push, pull, fetch**
- **Branch management**: create, checkout, view ahead/behind status
- **Tag management**: create and push tags
- **Diff viewer** for staged and unstaged changes
- Real-time git status per repository in the sidebar

### Docker Support
- **One-click Docker installation** for Windows (winget), macOS (Homebrew/DMG), and Linux (apt/dnf/pacman)
- **Container-based job execution**: run steps inside isolated Docker containers
- **Image management**: pull, list, and select from curated presets (Ubuntu, Node.js, Python, Go, Rust, Electron Builder)
- **Live install terminal** with real-time progress streaming

### Security
- **Secrets management** with global and per-repository scopes
- Secrets stored securely via Electron's `safeStorage` API
- **Secret scanning** to detect exposed credentials in workflow files
- GitHub OAuth authorization code flow with custom protocol (`orbitci://callback`)

### Monitoring
- **Real-time metrics**: CPU, RAM, GPU usage per step
- **Performance analytics** with duration trends and resource usage charts
- **Desktop notifications** on workflow completion (success/failure)

### Auto-Updater
- Built-in update system that checks for new releases, downloads and installs automatically
- Sidebar widget showing update progress

### Internationalization
- Full support for **English** and **Portuguese (Brazil)**
- Language switching in settings with instant UI update

## Installation

### Download

Grab the latest release for your platform:

| Platform | Format | Download |
|----------|--------|----------|
| Windows | `.exe` (NSIS installer) | [Latest Release](https://github.com/AndyTargino/OrbitCI/releases/latest) |
| macOS | `.dmg` | [Latest Release](https://github.com/AndyTargino/OrbitCI/releases/latest) |
| Linux | `.AppImage` / `.deb` | [Latest Release](https://github.com/AndyTargino/OrbitCI/releases/latest) |

### Build from Source

```bash
# Clone the repository
git clone https://github.com/AndyTargino/OrbitCI.git
cd OrbitCI

# Install dependencies
npm install

# Rebuild native modules for Electron
npm run rebuild

# Run in development mode
npm run dev

# Build for production
npm run package
```

**Requirements**: Node.js 20+, Git, npm

## Getting Started

1. **Launch OrbitCI** and log in with your GitHub account (OAuth or Personal Access Token)
2. **Add a repository**: clone from GitHub or link an existing local folder
3. **Create a workflow** at `.orbit/workflows/my-workflow.yml`:

```yaml
name: Build & Test
on:
  push:
    branches: [main]

jobs:
  build:
    steps:
      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build
        run: npm run build
```

4. **Click Run** in the dashboard to execute the workflow
5. **Watch live logs** as each step executes on your machine

## Workflow Syntax

OrbitCI supports standard GitHub Actions YAML with some additions:

```yaml
name: Release Pipeline
on:
  push:
    branches: [main]

jobs:
  release:
    steps:
      - name: Bump version
        id: version
        OrbitCI: version/bump-semver

      - name: Create Release
        if: steps.version.outputs.skip != 'true'
        OrbitCI: github/create-release
        with:
          tag-name: ${{ steps.version.outputs.tag }}
          name: Release ${{ steps.version.outputs.tag }}
          repo: ${{ github.repository }}

  build:
    needs: release
    container: node:20-bookworm
    steps:
      - name: Install & Build
        run: |
          npm ci
          npm run build
```

### Built-in Actions (`OrbitCI:`)

| Action | Description |
|--------|-------------|
| `github/create-release` | Create a GitHub release with tag and notes |
| `github/upload-asset` | Upload build artifacts to a release |
| `github/create-issue` | Open a GitHub issue |
| `github/comment` | Comment on an issue or PR |
| `github/set-status` | Set commit status check |
| `git/tag` | Create and push git tags |
| `git/commit` | Stage and commit changes |
| `version/bump-semver` | Auto-bump semantic version from commits |
| `file/replace` | Find and replace in files |
| `file/write` | Write content to a file |
| `docker/build` | Build a Docker image |
| `docker/push` | Push image to registry |

## Development

```bash
# Development with hot-reload
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint

# Generate database migrations
npm run db:generate
```

### Project Structure

```
src/
├── main/                  # Electron main process
│   ├── ipc/              # IPC request handlers
│   ├── runner/           # Workflow execution engine
│   │   ├── workflowRunner.ts   # Queue, triggers, context
│   │   ├── jobRunner.ts        # Job execution + output parsing
│   │   ├── stepRunner.ts       # Step execution (shell/action)
│   │   ├── expressionEngine.ts # ${{ }} expression evaluator
│   │   └── actions/            # Built-in OrbitCI actions
│   ├── services/         # Business logic (git, github, docker, sync)
│   ├── db/               # Schema, migrations, database init
│   └── git/              # Git operations via simple-git
├── preload/              # Electron context bridge
├── shared/               # Types & constants (cross-boundary)
└── renderer/             # React frontend
    └── src/
        ├── components/   # UI components (shadcn/ui + custom)
        ├── pages/        # Route pages
        ├── store/        # Zustand global state
        ├── hooks/        # Custom React hooks
        ├── i18n/         # Internationalization (en, pt)
        └── lib/          # Utilities & Electron API types
```

## Contributing

OrbitCI is fully open source and contributions are welcome! Feel free to open issues, suggest features, or submit pull requests.

1. Fork the repository
2. Create your feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

## License

MIT License. See [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with Electron, React, and a mass of mass.
</p>
