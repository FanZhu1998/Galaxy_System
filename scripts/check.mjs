import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectRoot } from './serve.mjs';

async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await check(file);
    else if (/\.m?js$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
for (const directory of ['src', 'scripts', 'test', 'vendor']) await check(join(projectRoot, directory));
console.log('All JavaScript source files passed syntax checks.');
