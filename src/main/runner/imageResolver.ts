/**
 * Maps GitHub Actions `runs-on` labels to Docker images.
 *
 * Users can also specify a full Docker image directly in `runs-on`
 * (e.g., `runs-on: node:20-alpine`). If the label doesn't match
 * any known GitHub-hosted runner, it's treated as a Docker image name.
 *
 * Cross-platform build strategy:
 * - All builds run in Linux containers (Docker on Windows/macOS uses Linux VM)
 * - `electron-builder` can cross-compile for all platforms from Linux:
 *   - Linux targets: native (AppImage, deb, rpm, snap)
 *   - Windows targets: via Wine (exe, msi, nsis)
 *   - macOS targets: unsigned dmg/zip from Linux
 * - For signed macOS builds, users should use GitHub Actions or a real macOS runner.
 */

const RUNS_ON_MAP: Record<string, string> = {
  // Ubuntu runners
  'ubuntu-latest': 'ubuntu:22.04',
  'ubuntu-24.04': 'ubuntu:24.04',
  'ubuntu-22.04': 'ubuntu:22.04',
  'ubuntu-20.04': 'ubuntu:20.04',

  // macOS runners → Linux-based cross-compilation
  // electron-builder can produce unsigned macOS .dmg/.zip from Linux.
  'macos-latest': 'ubuntu:22.04',
  'macos-15': 'ubuntu:22.04',
  'macos-14': 'ubuntu:22.04',
  'macos-13': 'ubuntu:22.04',

  // Windows runners → Linux-based cross-compilation via Wine
  // electron-builder uses Wine to build Windows NSIS/MSI installers from Linux.
  'windows-latest': 'ubuntu:22.04',
  'windows-2022': 'ubuntu:22.04',
  'windows-2019': 'ubuntu:22.04',

  // Self-hosted (use Ubuntu as default)
  'self-hosted': 'ubuntu:22.04',
}

/**
 * Resolve a `runs-on` value to a Docker image.
 *
 * Resolution order:
 * 1. If `job.container` is set, use that (takes priority)
 * 2. Look up `runs-on` in the known GitHub runner mapping
 * 3. If not found, treat `runs-on` itself as a Docker image name
 * 4. Fallback to `ubuntu:22.04`
 */
export function resolveDockerImage(
  runsOn?: string,
  container?: string
): string {
  // Explicit container takes priority
  if (container) return container

  if (!runsOn) return 'ubuntu:22.04'

  const label = runsOn.trim().toLowerCase()

  // Check if it matches a known runner label
  if (RUNS_ON_MAP[label]) return RUNS_ON_MAP[label]

  // Check partial matches (e.g., "ubuntu-latest" in a matrix expression result)
  for (const [key, image] of Object.entries(RUNS_ON_MAP)) {
    if (label.includes(key)) return image
  }

  // If it contains a slash or colon, treat it as a Docker image name directly
  // e.g., "node:20", "ghcr.io/my/image:latest"
  if (runsOn.includes('/') || runsOn.includes(':')) {
    return runsOn
  }

  // Fallback: use the label as-is (Docker will try to pull it)
  return runsOn
}

/**
 * Check if a runs-on label maps to a Windows container.
 * In OrbitCI all containers are Linux-based; cross-compilation uses Wine.
 * Always returns false so containers use /bin/sh.
 */
export function isWindowsImage(runsOn?: string): boolean {
  // All OrbitCI containers are Linux-based, even for Windows/macOS targets.
  // Cross-compilation is handled by tools like Wine/electron-builder inside Linux.
  return false
}

/**
 * Check if the runs-on label targets a Windows build (for logging/bootstrap).
 */
export function isWindowsTarget(runsOn?: string): boolean {
  if (!runsOn) return false
  return runsOn.trim().toLowerCase().includes('windows')
}

/**
 * Check if the runs-on label targets a macOS build (for logging/bootstrap).
 */
export function isMacOSTarget(runsOn?: string): boolean {
  if (!runsOn) return false
  return runsOn.trim().toLowerCase().includes('macos')
}
