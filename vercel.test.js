import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.VERCEL = '1';
process.env.DATABASE_URL = '';
process.env.POSTGRES_URL = '';
const { default: handler } = await import('./api/index.js');

async function request(url, method = 'GET', body) {
  const req = Readable.from([]);
  Object.assign(req, { url, method, headers: { host: 'store.example' }, body });
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
    assert.equal(JSON.parse(games.body).length, 6);
    assert.equal(JSON.parse(games.body).every(game => game.demo && !game.driveUrl), true);
    assert.equal(JSON.parse((await request('/api/session')).body).authenticated, false);
    const login = await request('/api/login', 'POST', { password: 'test-password-12345' });
    assert.equal(login.status, 503);
    assert.match(JSON.parse(login.body).error, /DATABASE_URL/);
    assert.equal((await request('/api/admin/games', 'POST', { title: 'Não salvar' })).status, 503);
    assert.equal(existsSync(process.env.DATA_DIR), false);
    assert.deepEqual(readdirSync(directory), []);
    assert.match((await request('/api/logout', 'POST')).headers['set-cookie'], /Secure/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
