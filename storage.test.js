import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { initializeDatabase, createStore, postgresQuery } from './lib/storage.js';

test('PostgreSQL: catálogo, sessões e tentativas são compartilhados entre instâncias', async () => {
  const pg = new PGlite();
  try {
    const db = { kind: 'postgres', query: (sql, args = []) => pg.query(postgresQuery(sql), args) };
    await initializeDatabase(db);
    const first = createStore(db), second = createStore(db);
    assert.equal((await first.games()).length, 6);
    const game = { title: 'Jogo persistente', published: false, description: 'Acentos: ação' };
    const id = await first.saveGame(game);
    assert.equal((await second.getGame(id)).description, game.description);
    await second.saveGame({ ...game, published: true }, id);
    assert.equal((await first.getGame(id)).published, true);
    await first.deleteGame(1);
    await initializeDatabase(db);
    assert.equal(await second.getGame(1), null, 'Exemplos excluídos não devem reaparecer');
    const token = await first.login('credential-hash');
    assert.equal(await second.authenticated(token, 'credential-hash'), true);
    assert.equal(await second.authenticated(token, 'changed-password-hash'), false);
    await second.logout(token);
    assert.equal(await first.authenticated(token, 'credential-hash'), false);
    const expired = await first.login('credential-hash');
    await pg.query('UPDATE sessions SET expires=0');
    assert.equal(await second.authenticated(expired, 'credential-hash'), false);
    const counts = await Promise.all(Array.from({ length: 11 }, (_, index) => (index % 2 ? first : second).attempt('same-ip')));
    assert.deepEqual(counts.sort((a,b) => a-b), Array.from({ length: 11 }, (_, index) => index+1));
    await second.resetAttempts('same-ip');
    assert.equal(await first.attempt('same-ip'), 1);
    await second.deleteGame(id);
    assert.equal(await first.getGame(id), null);
  } finally { await pg.close(); }
});
