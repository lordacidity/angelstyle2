// Shared env: Aier reads the SAME repo-root .env as Studio/Phonedeck (one source
// of truth). `dotenv/config` would only look in the cwd (aier/), but the keys now
// live one level up at <repo root>/.env. Imported FIRST in index.js so the vars
// are populated before any route/lib module executes. Guarded so it's a no-op in
// production, where the platform injects env vars and there is no .env on disk.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// aier/server -> aier -> repo root
const rootEnv = path.resolve(__dirname, '..', '..', '.env');
if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });
