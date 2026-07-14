import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const removeData = args.has('--remove-data');
const yes = args.has('--yes');
const rl = yes ? null : createInterface({ input: process.stdin, output: process.stdout });

try {
  let confirmed = yes;
  if (rl) {
    const scope = removeData ? '依赖、安装配置和业务数据' : '依赖和安装配置（保留业务数据）';
    const answer = await rl.question(`将删除${scope}，是否继续？[y/N] `);
    confirmed = /^y(es)?$/i.test(answer.trim());
  }
  if (!confirmed) {
    console.log('已取消删除。');
  } else {
    await fs.rm(path.join(root, 'node_modules'), { recursive: true, force: true });
    await fs.rm(path.join(root, '.home-relay-studio.json'), { force: true });
    if (removeData) await fs.rm(path.join(root, 'data'), { recursive: true, force: true });
    console.log(`删除完成。${removeData ? '业务数据已删除。' : '业务数据已保留。'}`);
  }
} catch (error) {
  console.error(`删除失败：${error.message}`);
  process.exitCode = 1;
} finally {
  rl?.close();
}
