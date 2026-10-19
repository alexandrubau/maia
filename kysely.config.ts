import { defineConfig } from 'kysely-ctl';
import { db } from './src/db.ts';

// For `npx kysely migrate:*`. The Docker image runs `migrate:latest` on every start.
export default defineConfig({
  kysely: db,
  migrations: {
    migrationFolder: 'src/migrations',
    migrationTableName: 'maia_migration',
    migrationLockTableName: 'maia_migration_lock',
  },
});
