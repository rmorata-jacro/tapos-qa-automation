import { existsSync } from 'node:fs';
import path from 'node:path';

/** Loads the developer's local, git-ignored .env without overriding variables already set. */
export function loadLocalEnv(): void {
  const file = path.resolve(__dirname, '..', '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}
