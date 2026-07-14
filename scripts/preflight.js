import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function checkRuntime() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (major < 18) throw new Error(`Node.js 版本过低：${process.version}，请安装 Node.js 18 或更高版本。`);
  const npm = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], { encoding: 'utf8' });
  if (npm.status !== 0) throw new Error('未检测到 npm，请安装包含 npm 的 Node.js。');
  return { node: process.version, npm: npm.stdout.trim() };
}

export async function checkWritable(directory) {
  const marker = path.join(directory, `.write-test-${process.pid}`);
  try {
    await fs.writeFile(marker, 'ok');
    await fs.unlink(marker);
  } catch (error) {
    throw new Error(`项目目录不可写：${error.message}`);
  }
}

export function isPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.unref();
    tester.once('error', () => resolve(false));
    tester.listen({ port, host }, () => tester.close(() => resolve(true)));
  });
}

export async function findAvailablePort(startPort, host = '127.0.0.1', attempts = 100) {
  for (let port = startPort; port < startPort + attempts && port <= 65535; port += 1) {
    if (await isPortAvailable(port, host)) return port;
  }
  throw new Error(`从 ${startPort} 开始的 ${attempts} 个端口均被占用。`);
}
