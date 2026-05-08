/**
 * Lightweight local environment check for Wariskan.
 *
 * This avoids network calls so it is safe to run before a demo.
 */

import 'dotenv/config';
import { existsSync } from 'node:fs';

const checks = [];

function check(label, ok, hint = '', required = true) {
  checks.push({ label, ok, hint, required });
  console.log(`${ok ? 'OK ' : 'MISS'} ${label}${ok || !hint ? '' : ` - ${hint}`}`);
}

const major = Number(process.versions.node.split('.')[0]);
check('Node.js >= 20', major >= 20, `current: ${process.version}`);
check('.env file exists', existsSync('.env'), 'optional if secrets.ps1 already set process env', false);

for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
  check(key, Boolean(process.env[key]), `set ${key} in .env or secrets.ps1`);
}

check(
  'OPENAI_TRANSCRIBE_MODEL',
  Boolean(process.env.OPENAI_TRANSCRIBE_MODEL),
  'optional, defaults to gpt-4o-mini-transcribe in workflow',
  false
);

const hasGoogleKeyPath = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH);
const hasGoogleInline = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
check(
  'Google service account',
  hasGoogleKeyPath || hasGoogleInline,
  'set GOOGLE_SERVICE_ACCOUNT_KEY_PATH or EMAIL + PRIVATE_KEY before enabling Sheets'
);

check('HELPER_API_URL', Boolean(process.env.HELPER_API_URL), 'default can be http://localhost:3001');
check('HELPER_API_KEY', Boolean(process.env.HELPER_API_KEY), 'default can be dev');

const failed = checks.filter((item) => item.required && !item.ok).length;
if (failed > 0) {
  console.log(`\n${failed} required check(s) missing.`);
  process.exit(1);
}

console.log('\nEnvironment looks ready enough for local development.');
