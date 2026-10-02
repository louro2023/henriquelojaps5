import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getStore } from './lib/storage.js';
import { issueSession, authenticated, verifyPassword } from './lib/auth.js';

test('JSON preserva jogos entre instâncias e serializa alterações simultâneas', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'henrique-json-'));
  process.env.DATA_DIR = directory;
  process.env.BLOB_READ_WRITE_TOKEN = '';
  delete process.env.VERCEL;
  try {
    const first = getStore(), second = getStore();
    assert.deepEqual(await first.games(), []);
    const ids = await Promise.all(Array.from({ length: 10 }, (_, index) => first.saveGame({ title: 'Jogo ' + index, published: false })));
    assert.equal(new Set(ids).size, 10);
    assert.equal((await second.games()).length, 10);
    await second.saveGame({ title: 'Atualizado', published: true }, ids[0]);
    assert.equal((await first.getGame(ids[0])).title, 'Atualizado');
    await first.deleteGame(1);
    assert.equal(await getStore().getGame(1), null);
    assert.equal(JSON.parse(await readFile(path.join(directory, 'catalogue.json'))).games.length, 9);
    for (const game of await second.games()) await second.deleteGame(game.id);
    assert.deepEqual(await getStore().games(), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Sessão assinada funciona sem banco, rejeita falsificação, expiração e troca de senha', async () => {
  process.env.ADMIN_PASSWORD = 'test-password-12345';
  assert.equal(verifyPassword('wrong'), false);
  assert.equal(verifyPassword(process.env.ADMIN_PASSWORD), true);
  const now = Date.now();
  const token = issueSession(now);
  assert.equal(authenticated(token, now), true);
  const anotherInstance = await import('./lib/auth.js?second-instance');
  assert.equal(anotherInstance.authenticated(token, now), true);
  assert.equal(authenticated(token + 'x', now), false);
  assert.equal(authenticated(token, now + 28800001), false);
  process.env.ADMIN_PASSWORD = 'changed-password-12345';
  assert.equal(authenticated(token, now), false);
});
