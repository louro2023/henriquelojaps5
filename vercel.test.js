import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.VERCEL = '1';
process.env.DATABASE_URL = '';
process.env.POSTGRES_URL = '';
process.env.BLOB_READ_WRITE_TOKEN = '';
process.env.ADMIN_PASSWORD = 'test-password-12345';
const { default: handler } = await import('./api/index.js');

async function request(url, method = 'GET', body, cookie = '') {
  const req = Readable.from([]);
  Object.assign(req, { url, method, headers: { host: 'store.example', cookie }, body });
  const headers = {};
  let status = 200, result;
  const res = {
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    writeHead(code, values) { status = code; Object.entries(values).forEach(([name,value]) => this.setHeader(name,value)); },
    end(value) { result = String(value); },
  };
  await handler(req, res);
  return { status, headers, body: result };
}

test('Vercel sem banco abre a loja e o painel sem gravar arquivos', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'henrique-vercel-'));
  process.env.DATA_DIR = path.join(directory, 'must-not-exist');
  try {
    const home = await request('/');
    assert.equal(home.status, 200);
    assert.match(home.body, /Henrique Store/);
    assert.equal((await request('/admin')).status, 200);
    const games = await request('/api/games');
    assert.equal(games.status, 200);
    assert.deepEqual(JSON.parse(games.body), []);
    assert.equal(JSON.parse((await request('/api/session')).body).authenticated, false);
    const login = await request('/api/login', 'POST', { password: 'test-password-12345' });
    assert.equal(login.status, 200, 'Login deve funcionar sem banco nem Blob');
    const cookie = login.headers['set-cookie'].split(';')[0];
    assert.equal((await request('/api/admin/games', 'GET', undefined, cookie)).status, 200);
    assert.deepEqual(JSON.parse((await request('/api/admin/games', 'GET', undefined, cookie)).body), []);
    assert.equal(JSON.parse((await request('/api/admin/storage', 'GET', undefined, cookie)).body).writable, false);
    const game = { title: 'Não salvar', description: 'Teste', category: 'Indie', platform: 'PC', cover: '', driveUrl: '', instructions: '', published: false };
    const write = await request('/api/admin/games', 'POST', game, cookie);
    assert.equal(write.status, 503);
    assert.match(write.body, /Blob/);
    assert.equal((await request('/api/admin/games', 'POST', game)).status, 401);
    assert.equal(existsSync(process.env.DATA_DIR), false);
    assert.deepEqual(readdirSync(directory), []);
    assert.match((await request('/api/logout', 'POST')).headers['set-cookie'], /Secure/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
