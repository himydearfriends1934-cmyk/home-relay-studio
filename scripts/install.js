import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { checkRuntime, checkWritable, findAvailablePort, isPortAvailable } from './preflight.js';
import { createSubscriptionToken, isUsableSubscriptionToken } from '../src/subscription-token.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const valueAfter = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const requestedPort = Number.parseInt(valueAfter('--port') || '8787', 10);
const yes = args.has('--yes');
const autoReplace = args.has('--replace-port');
const rl = yes ? null : createInterface({ input: process.stdin, output: process.stdout });

try {
  console.log('Home Relay Studio 安装前环境检测');
  if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) throw new Error('端口必须是 1 到 65535 之间的整数。');
  const runtime = checkRuntime();
  console.log(`✓ Node.js ${runtime.node}`);
  console.log(`✓ npm ${runtime.npm}`);
  await checkWritable(root);
  console.log('✓ 项目目录可写');

  let port = requestedPort;
  if (!(await isPortAvailable(port))) {
    const replacement = await findAvailablePort(port + 1);
    console.log(`! 端口 ${port} 已被占用，检测到可用端口 ${replacement}。`);
    let accepted = autoReplace;
    if (!accepted && rl) {
      const answer = await rl.question(`是否将服务端口替换为 ${replacement}？[Y/n] `);
      accepted = !answer.trim() || /^y(es)?$/i.test(answer.trim());
    }
    if (!accepted) throw new Error('端口替换未确认，安装已取消。可使用 --port 指定其他端口。');
    port = replacement;
  } else {
    console.log(`✓ 端口 ${port} 可用`);
  }

  console.log('正在安装依赖…');
  const npm = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install'], { cwd: root, stdio: 'inherit' });
  if (npm.status !== 0) throw new Error('npm install 执行失败。');
  const configPath = path.join(root, '.home-relay-studio.json');
  const existingConfig = await readInstallConfig(configPath);
  const subscriptionToken = isUsableSubscriptionToken(existingConfig.subscriptionToken)
    ? existingConfig.subscriptionToken
    : createSubscriptionToken();
  await fs.writeFile(configPath, `${JSON.stringify({
    ...existingConfig,
    host: '127.0.0.1',
    port,
    subscriptionToken,
  }, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') await fs.chmod(configPath, 0o600);
  console.log(`\n安装完成。运行 npm start 后访问 http://127.0.0.1:${port}`);
} catch (error) {
  console.error(`\n安装失败：${error.message}`);
  process.exitCode = 1;
} finally {
  rl?.close();
}

async function readInstallConfig(configPath) {
  try {
    const value = JSON.parse(await fs.readFile(configPath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
