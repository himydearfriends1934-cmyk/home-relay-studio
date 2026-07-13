import fs from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const COPY_DIRS = ['src', 'public', 'test'];
const COPY_FILES = ['package.json', 'package-lock.json', 'README.md'];

export async function getUpgradeStatus(projectRoot) {
  const config = getUpgradeConfig(projectRoot);
  if (!config.repo) {
    return {
      configured: false,
      enabled: false,
      branch: config.branch,
      message: 'Set UPGRADE_GITHUB_REPO to owner/repo or a GitHub URL.',
    };
  }

  const [current, remote] = await Promise.all([readCurrentRevision(projectRoot), readRemoteRevision(config)]);
  const upToDate = Boolean(current.sha && remote.sha && current.sha === remote.sha);
  return {
    configured: true,
    enabled: true,
    repo: config.repo,
    branch: config.branch,
    current,
    remote,
    upToDate,
    message: upToDate ? 'Already on GitHub main.' : 'GitHub main has a different revision.',
  };
}

export async function runUpgrade(projectRoot) {
  const config = getUpgradeConfig(projectRoot);
  if (!config.repo) {
    return {
      changed: false,
      restartScheduled: false,
      status: await getUpgradeStatus(projectRoot),
    };
  }

  const status = await getUpgradeStatus(projectRoot);
  if (status.upToDate) {
    return {
      changed: false,
      restartScheduled: false,
      status,
      steps: ['Checked GitHub main. No update was needed.'],
    };
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'home-relay-upgrade-'));
  const archivePath = path.join(tempRoot, 'source.tgz');
  const extractDir = path.join(tempRoot, 'source');
  const steps = [];

  try {
    await downloadTarball(config, archivePath);
    steps.push('Downloaded GitHub main archive.');
    await fs.mkdir(extractDir, { recursive: true });
    await runCommand('tar', ['-xzf', archivePath, '-C', extractDir, '--strip-components=1']);
    steps.push('Extracted archive.');
    await copyRelease(extractDir, projectRoot);
    steps.push('Updated application files.');
    if (config.install !== false) {
      await installDependencies(projectRoot);
      steps.push('Installed production dependencies.');
    }
    if (status.remote?.sha) {
      await fs.writeFile(path.join(projectRoot, '.upgrade-revision'), `${status.remote.sha}\n`, 'utf8');
    }
    return {
      changed: true,
      restartScheduled: getRestartMode() !== 'none',
      status: {
        ...status,
        current: await readCurrentRevision(projectRoot),
      },
      steps,
      restart: {
        mode: getRestartMode(),
        commandConfigured: Boolean(process.env.UPGRADE_RESTART_COMMAND),
      },
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

export function scheduleUpgradeRestart() {
  const mode = getRestartMode();
  if (mode === 'none') return false;
  const command = process.env.UPGRADE_RESTART_COMMAND || '';
  setTimeout(() => {
    if (command) {
      const child = spawn(command, {
        shell: true,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return;
    }
    process.exit(0);
  }, 900);
  return true;
}

function getUpgradeConfig(projectRoot) {
  return {
    projectRoot,
    repo: normalizeRepo(process.env.UPGRADE_GITHUB_REPO || process.env.GITHUB_REPOSITORY || ''),
    branch: process.env.UPGRADE_BRANCH || 'main',
    token: process.env.UPGRADE_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '',
    install: process.env.UPGRADE_SKIP_INSTALL !== '1',
  };
}

function getRestartMode() {
  if (process.env.UPGRADE_RESTART_COMMAND) return 'command';
  if (process.env.UPGRADE_AUTO_RESTART === '1') return 'exit';
  return 'none';
}

function normalizeRepo(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const withoutGit = text.replace(/\.git$/, '');
  const match = withoutGit.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/#?]+)/i);
  if (match?.groups?.owner && match?.groups?.repo) {
    return `${match.groups.owner}/${match.groups.repo}`;
  }
  const simple = withoutGit.match(/^(?<owner>[^/\s]+)\/(?<repo>[^/\s]+)$/);
  if (simple?.groups?.owner && simple?.groups?.repo) {
    return `${simple.groups.owner}/${simple.groups.repo}`;
  }
  return '';
}

async function readCurrentRevision(projectRoot) {
  const marker = await readTextIfExists(path.join(projectRoot, '.upgrade-revision'));
  if (marker.trim()) {
    return {
      source: 'marker',
      sha: marker.trim(),
      short: shortSha(marker.trim()),
    };
  }
  try {
    const output = await runCommand('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, timeoutMs: 8000 });
    const sha = output.trim();
    return {
      source: 'git',
      sha,
      short: shortSha(sha),
    };
  } catch {
    return {
      source: 'unknown',
      sha: '',
      short: '',
    };
  }
}

async function readRemoteRevision(config) {
  const response = await fetch(`https://api.github.com/repos/${config.repo}/commits/${encodeURIComponent(config.branch)}`, {
    headers: githubHeaders(config),
  });
  if (!response.ok) {
    throw new Error(`GitHub commit check failed with HTTP ${response.status}.`);
  }
  const json = await response.json();
  const sha = String(json.sha || '');
  return {
    source: 'github',
    sha,
    short: shortSha(sha),
    url: json.html_url || '',
    date: json.commit?.committer?.date || '',
  };
}

async function downloadTarball(config, archivePath) {
  const response = await fetch(`https://api.github.com/repos/${config.repo}/tarball/${encodeURIComponent(config.branch)}`, {
    headers: githubHeaders(config),
  });
  if (!response.ok) {
    throw new Error(`GitHub archive download failed with HTTP ${response.status}.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(archivePath, bytes);
}

function githubHeaders(config) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'HomeRelayStudio-Upgrader',
    'x-github-api-version': '2022-11-28',
  };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  return headers;
}

async function copyRelease(sourceDir, projectRoot) {
  for (const dir of COPY_DIRS) {
    const from = path.join(sourceDir, dir);
    const to = path.join(projectRoot, dir);
    if (!(await exists(from))) continue;
    await fs.rm(to, { recursive: true, force: true });
    await fs.cp(from, to, { recursive: true });
  }

  for (const file of COPY_FILES) {
    const from = path.join(sourceDir, file);
    const to = path.join(projectRoot, file);
    if (!(await exists(from))) continue;
    await fs.copyFile(from, to);
  }
}

async function installDependencies(projectRoot) {
  const hasLock = await exists(path.join(projectRoot, 'package-lock.json'));
  const args = hasLock ? ['ci', '--omit=dev'] : ['install', '--omit=dev'];
  await runCommand('npm', args, {
    cwd: projectRoot,
    timeoutMs: 300000,
  });
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      shell: process.platform === 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    const errorChunks = [];
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out.`));
    }, options.timeoutMs || 120000);

    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => errorChunks.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      const output = Buffer.concat(chunks).toString('utf8');
      const errorOutput = Buffer.concat(errorChunks).toString('utf8');
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(new Error(`${command} exited with code ${code}: ${errorOutput.slice(0, 1000)}`));
    });
  });
}

function shortSha(value) {
  return String(value || '').slice(0, 7);
}
