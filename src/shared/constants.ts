export const APP_NAME = 'OrbitCI'
export const ORBIT_DIR = '.orbit'
export const WORKFLOWS_DIR = `${ORBIT_DIR}/workflows`
export const GITHUB_WORKFLOWS_DIR = '.github/workflows'
export const ARTIFACTS_DIR = `${ORBIT_DIR}/artifacts`
export const RELEASES_DIR = `${ORBIT_DIR}/releases`

/**
 * Workflow directory resolution order:
 * 1. `.github/workflows/` — primary (synced with GitHub)
 * 2. `.orbit/workflows/`  — manual/local override
 *
 * The runner and UI always prefer `.github/workflows/` if it exists.
 */
export const WORKFLOW_DIRS = [GITHUB_WORKFLOWS_DIR, WORKFLOWS_DIR] as const

export const MIN_POLL_INTERVAL = 30 // seconds
export const DEFAULT_POLL_INTERVAL = 60 // seconds
export const DEFAULT_JOB_TIMEOUT = 60 // minutes
export const DEFAULT_MAX_CONCURRENT = 1

export const IPC_CHANNELS = {
  // Auth
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_GET_USER: 'auth:getUser',
  AUTH_GITHUB_OAUTH_START: 'auth:github:oauthStart',

  // Repos
  REPOS_LIST: 'repos:list',
  REPOS_ADD: 'repos:add',
  REPOS_REMOVE: 'repos:remove',
  REPOS_SYNC: 'repos:sync',
  REPOS_LIST_GITHUB: 'repos:listGitHub',
  REPOS_CLONE: 'repos:clone',
  REPOS_UPDATE: 'repos:update',
  REPOS_LINK: 'repos:link',
  REPOS_SELECT_FOLDER: 'repos:selectFolder',
  REPOS_OPEN_FOLDER: 'repos:openFolder',
  REPOS_DELETE_ORBIT_DIR: 'repos:deleteOrbitDir',
  REPOS_CHECK_GITHUB_WORKFLOWS: 'repos:checkGithubWorkflows',
  REPOS_IMPORT_GITHUB_WORKFLOWS: 'repos:importGithubWorkflows',
  REPOS_LIST_GITHUB_WORKFLOWS: 'repos:listGithubWorkflows',
  REPOS_FIND_LOCAL: 'repos:findLocal',
  REPOS_GET_GITHUB_WORKFLOW_CONTENT: 'repos:getGithubWorkflowContent',
  REPOS_IMPORT_GITHUB_WORKFLOWS_SELECTIVE: 'repos:importGithubWorkflowsSelective',

  // Workflows
  WORKFLOWS_LIST: 'workflows:list',
  WORKFLOWS_GET: 'workflows:get',
  WORKFLOWS_SAVE: 'workflows:save',
  WORKFLOWS_RUN: 'workflows:run',
  WORKFLOWS_CREATE: 'workflows:create',
  WORKFLOWS_SCAN_SECRETS: 'workflows:scanSecrets',

  // GitHub Actions (remote)
  GITHUB_RUNS_LIST: 'github:runsList',
  GITHUB_RUN_JOBS: 'github:runJobs',
  GITHUB_JOB_LOGS: 'github:jobLogs',
  GITHUB_REPO_STATS: 'github:repoStats',
  GITHUB_PR_COUNTS: 'github:prCounts',
  GITHUB_COMMIT_ACTIVITY: 'github:commitActivity',
  GITHUB_CONTRIBUTORS: 'github:contributors',
  GITHUB_LANGUAGES: 'github:languages',
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',

  // Runs
  RUNS_LIST: 'runs:list',
  RUNS_GET: 'runs:get',
  RUNS_GET_LOGS: 'runs:getLogs',
  RUNS_GET_JOBS: 'runs:getJobs',
  RUNS_GET_STEPS: 'runs:getSteps',
  RUNS_CANCEL: 'runs:cancel',
  RUNS_GET_METRICS: 'runs:getMetrics',
  RUNS_GET_JOB_GRAPH: 'runs:getJobGraph',

  // Git
  GIT_STATUS: 'git:status',
  GIT_DIFF: 'git:diff',
  GIT_STAGE: 'git:stage',
  GIT_UNSTAGE: 'git:unstage',
  GIT_STAGE_ALL: 'git:stageAll',
  GIT_DISCARD: 'git:discard',
  GIT_DISCARD_ALL: 'git:discardAll',
  GIT_COMMIT: 'git:commit',
  GIT_PUSH: 'git:push',
  GIT_PULL: 'git:pull',
  GIT_FETCH: 'git:fetch',
  GIT_LOG: 'git:log',
  GIT_BRANCHES: 'git:branches',
  GIT_CREATE_BRANCH: 'git:createBranch',
  GIT_CHECKOUT: 'git:checkout',
  GIT_TAGS: 'git:tags',
  GIT_CREATE_TAG: 'git:createTag',
  GIT_MERGE: 'git:merge',
  GIT_MERGE_ABORT: 'git:mergeAbort',
  GIT_STASH: 'git:stash',
  GIT_STASH_POP: 'git:stashPop',
  GIT_STASH_LIST: 'git:stashList',
  GIT_DELETE_BRANCH: 'git:deleteBranch',
  GIT_RENAME_BRANCH: 'git:renameBranch',
  GIT_REVERT: 'git:revert',
  GIT_AMEND: 'git:amend',
  GIT_CHERRY_PICK: 'git:cherryPick',
  GIT_REMOTES: 'git:remotes',
  GIT_UNSTAGE_ALL: 'git:unstageAll',
  GIT_DIFF_STAGED: 'git:diffStaged',
  GIT_SHOW_COMMIT: 'git:showCommit',

  // Docker
  DOCKER_STATUS: 'docker:status',
  DOCKER_IMAGES: 'docker:images',
  DOCKER_CONTAINERS: 'docker:containers',
  DOCKER_PULL: 'docker:pull',
  DOCKER_REMOVE_CONTAINER: 'docker:removeContainer',

  // Secrets
  SECRETS_LIST: 'secrets:list',
  SECRETS_SET: 'secrets:set',
  SECRETS_DELETE: 'secrets:delete',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  // Notifications
  NOTIFY_TEST: 'notify:test',

  // Docker (extended)
  DOCKER_INSTALL: 'docker:install',

  // Updater
  UPDATER_CHECK: 'updater:check',
  UPDATER_DOWNLOAD: 'updater:download',
  UPDATER_INSTALL: 'updater:install',
  UPDATER_GET_VERSION: 'updater:getVersion',

  // Events (main → renderer)
  EVENT_RUN_LOG: 'event:runLog',
  EVENT_RUN_STATUS: 'event:runStatus',
  EVENT_SYNC: 'event:sync',
  EVENT_DOCKER_LOG: 'event:dockerLog',
  EVENT_DOCKER_INSTALL: 'event:dockerInstall',
  EVENT_OAUTH_CALLBACK: 'event:oauth:callback',
  EVENT_UPDATER: 'event:updater',
  EVENT_GIT_CHANGED: 'event:gitChanged'
} as const
