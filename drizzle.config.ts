import type { Config } from 'drizzle-kit'
import { join } from 'path'
import { homedir } from 'os'

export default {
  schema: './src/main/db/schema.ts',
  out: './src/main/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: join(homedir(), '.orbitci', 'orbit.db')
  }
} satisfies Config
