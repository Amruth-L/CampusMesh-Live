const { spawnSync } = require('node:child_process');
const path = require('node:path');
// A single-service deployment uses its public origin, never a developer's .env URL.
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
  cwd: path.resolve(__dirname, '../frontend'),
  env: { ...process.env, VITE_API_URL: '/', VITE_API_BASE_URL: '/' },
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
