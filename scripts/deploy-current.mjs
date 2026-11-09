import { execFileSync, spawnSync } from 'node:child_process';

// Webhooks can arrive out of order. Only the current production head may deploy.
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const remote = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], {
  encoding: 'utf8', timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
}).trim().split(/\s+/)[0];
if (!/^[a-f0-9]{40}$/.test(remote)) throw new Error('Cannot verify production branch; deployment stopped.');
if (commit !== remote) {
  console.log('Skipping outdated build: this commit is no longer the production branch head.');
} else {
  const result = spawnSync('npx', ['wrangler', 'deploy'], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
}
