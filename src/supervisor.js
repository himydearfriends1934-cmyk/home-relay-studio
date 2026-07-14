import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const serverPath = path.join(projectRoot, 'src', 'server.js');
const childPidPath = path.join(projectRoot, '.home-relay-studio.child.pid');
const restartWindowMs = 30_000;
const maxRestartsInWindow = 5;

let child = null;
let stopping = false;
let restartTimes = [];

startServer();

process.on('SIGINT', () => stopSupervisor('SIGINT'));
process.on('SIGTERM', () => stopSupervisor('SIGTERM'));

function startServer() {
  const now = Date.now();
  restartTimes = restartTimes.filter((time) => now - time < restartWindowMs);
  if (restartTimes.length >= maxRestartsInWindow) {
    console.error('Server restarted too many times; stopping supervisor.');
    cleanupChildPid().finally(() => process.exit(1));
    return;
  }
  restartTimes.push(now);

  child = spawn(process.execPath, [serverPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      UPGRADE_AUTO_RESTART: process.env.UPGRADE_AUTO_RESTART || '1',
    },
    stdio: 'inherit',
    windowsHide: true,
  });

  child.once('spawn', () => {
    writeChildPid(child.pid).catch((error) => {
      console.error(`Failed to write child pid: ${error.message}`);
    });
  });

  child.once('error', (error) => {
    console.error(`Failed to start server: ${error.message}`);
  });

  child.once('exit', (code, signal) => {
    cleanupChildPid()
      .catch((error) => {
        console.error(`Failed to remove child pid: ${error.message}`);
      })
      .finally(() => {
        child = null;
        if (stopping) {
          process.exit(code ?? 0);
          return;
        }
        console.log(`Server exited with ${signal || code}; restarting...`);
        setTimeout(startServer, 1000);
      });
  });
}

function stopSupervisor(signal) {
  if (stopping) return;
  stopping = true;
  if (!child || child.killed) {
    cleanupChildPid().finally(() => process.exit(0));
    return;
  }
  child.kill(signal);
  setTimeout(() => {
    if (child && !child.killed) child.kill('SIGKILL');
  }, 5000);
}

async function writeChildPid(pid) {
  if (!pid) return;
  await fs.writeFile(childPidPath, `${pid}\n`, 'utf8');
}

async function cleanupChildPid() {
  await fs.rm(childPidPath, { force: true });
}
