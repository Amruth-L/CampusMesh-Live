'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

async function main() {
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'campusmesh-otp-build-'));
  const archive = path.resolve(process.argv[2] || path.join(os.tmpdir(), `campusmesh-otp-mailer-${Date.now()}.zip`));
  try {
    // Copy only these reviewed sources. No .env files, workspace secrets,
    // development tests or unrelated backend dependencies enter the archive.
    for (const file of ['index.js', 'package.json', 'package-lock.json']) {
      await fs.copyFile(path.join(__dirname, file), path.join(staging, file));
    }
    execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: staging, stdio: 'pipe' });
    await fs.mkdir(path.dirname(archive), { recursive: true });
    // zip updates existing files; start a fresh archive to exclude stale files.
    await fs.rm(archive, { force: true });
    execFileSync('zip', ['-q', '-r', archive, 'index.js', 'package.json', 'package-lock.json', 'node_modules'], { cwd: staging, stdio: 'pipe' });
    console.log(archive);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

main().catch(() => {
  console.error('OTP mailer packaging failed. Check npm dependencies and the zip command.');
  process.exitCode = 1;
});
