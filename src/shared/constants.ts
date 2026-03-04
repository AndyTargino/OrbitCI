export const APP_NAME = 'OrbitCI'
export const ORBIT_DIR = '.orbit'
export const WORKFLOWS_DIR = `${ORBIT_DIR}/workflows`
export const ARTIFACTS_DIR = `${ORBIT_DIR}/artifacts`
export const RELEASES_DIR = `${ORBIT_DIR}/releases`

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
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',

  // Runs
  RUNS_LIST: 'runs:list',
  RUNS_GET: 'runs:get',
  RUNS_GET_LOGS: 'runs:getLogs',
  RUNS_GET_JOBS: 'runs:getJobs',
  RUNS_GET_STEPS: 'runs:getSteps',
  RUNS_CANCEL: 'runs:cancel',
  RUNS_GET_METRICS: 'runs:getMetrics',

  // Git
  GIT_STATUS: 'git:status',
  GIT_DIFF: 'git:diff',
  GIT_STAGE: 'git:stage',
  GIT_UNSTAGE: 'git:unstage',
  GIT_STAGE_ALL: 'git:stageAll',
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

  // Events (main → renderer)
  EVENT_RUN_LOG: 'event:runLog',
  EVENT_RUN_STATUS: 'event:runStatus',
  EVENT_SYNC: 'event:sync',
  EVENT_DOCKER_LOG: 'event:dockerLog',
  EVENT_OAUTH_CALLBACK: 'event:oauth:callback'
} as const
