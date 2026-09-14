import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createGalaxyServer, projectRoot } from '../scripts/serve.mjs';

test('clone-ready server serves sandboxed UI and local dependencies without exposing repository metadata', async t => {
  const server = createGalaxyServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await (await fetch(origin)).text();
  assert.match(page, /sandbox="allow-scripts"/);
  const inner = await (await fetch(origin + '/src/galaxy.html')).text();
  assert.match(inner, /Content-Security-Policy/);
  for (const route of ['/src/galaxy.js', '/src/physics.js', '/src/systems.js', '/src/base.css', '/src/galaxy.css', '/vendor/three/three.module.js', '/vendor/lucide/icons.js']) {
    const result = await fetch(origin + route);
    assert.equal(result.status, 200, route);
    assert.equal(result.headers.get('access-control-allow-origin'), '*');
    await result.arrayBuffer();
  }
  for (const route of ['/.git/config', '/package.json', '/src/..%2fpackage.json', '/src/%5c..%5c.git%5cconfig', '/does-not-exist']) assert.ok((await fetch(origin + route)).status >= 400);
  assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
});

test('original exported visualization remains byte-for-byte unchanged', async () => {
  const original = await readFile(join(projectRoot, 'gravity-galaxy.html'));
  assert.equal(createHash('sha256').update(original).digest('hex'), '132363856fbcbe809f97d2fb53e2ddc76846753164e6f3756b4f2f8dcb3d7ede');
});
