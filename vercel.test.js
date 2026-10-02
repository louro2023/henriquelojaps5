import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { firebaseStore } from './lib/firebase.js';

process.env.VERCEL = '1';
process.env.ADMIN_PASSWORD = 'test-password-12345';
delete process.env.FIREBASE_SERVICE_ACCOUNT;
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

function mockFirebase(t) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const credential = { project_id: 'lojaps5', client_email: 'test@lojaps5.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const state = { document: null, revision: 1, oauthCalls: 0, conflicts: 0, fail: false, deny: false };
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input);
    if (url.hostname === 'oauth2.googleapis.com') {
      state.oauthCalls++;
      const [header, payload, signature] = options.body.get('assertion').split('.');
      assert.equal(createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(publicKey, signature, 'base64url'), true);
      const claims = JSON.parse(Buffer.from(payload, 'base64url'));
      assert.equal(claims.iss, credential.client_email);
      assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
      assert.match(claims.scope, /firebase.database/);
      return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
    }
    assert.equal(url.hostname, 'lojaps5-default-rtdb.firebaseio.com');
    assert.equal(options.cache, 'no-store');
    if (state.fail) return Response.json({ error: 'unavailable' }, { status: 503 });
    if (state.deny) return Response.json({ error: 'Permission denied' }, { status: 401 });
    if (!options.headers.Authorization) {
      assert.equal(options.method, 'GET');
      assert.equal(url.pathname, '/catalogue/games.json');
      assert.equal(url.searchParams.get('orderBy'), '"published"');
      assert.equal(url.searchParams.get('equalTo'), 'true');
      return Response.json(Object.fromEntries(Object.entries(state.document?.games || {}).filter(([,game]) => game.published)));
    }
    assert.equal(options.headers.Authorization, 'Bearer test-access-token');
    if (options.method === 'PUT') {
      assert.equal(url.pathname, '/catalogue.json');
      assert.equal(options.headers['if-match'], `"${state.revision}"`);
      if (state.conflicts > 0) {
        state.conflicts--;
        state.revision++;
        state.document.games['game-99'] = { title: 'Outra sessão', id: 99, published: false };
        return Response.json(state.document, { status: 412 });
      }
      state.document = JSON.parse(options.body);
      state.revision++;
      if (!Object.keys(state.document.games).length) delete state.document.games;
      return Response.json(state.document);
    }
    if (url.pathname === '/catalogue.json') {
      assert.equal(options.headers['X-Firebase-ETag'], 'true');
      return Response.json(state.document, { headers: { etag: `"${state.revision}"` } });
    }
    if (url.pathname === '/catalogue/games.json') return Response.json(state.document?.games || null);
    const key = url.pathname.split('/').at(-1).replace('.json', '');
    return Response.json(state.document?.games?.[key] || null);
  });
  return { state, credentials: JSON.stringify(credential) };
}

test('Vercel mantém a senha atual e informa a credencial necessária', async t => {
  mockFirebase(t);
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  assert.equal((await request('/admin')).status, 200);
  assert.deepEqual(JSON.parse((await request('/api/games')).body), []);
  assert.equal(JSON.parse((await request('/api/session')).body).authenticated, false);
  const login = await request('/api/login', 'POST', { password: process.env.ADMIN_PASSWORD });
  assert.equal(login.status, 200);
  const cookie = login.headers['set-cookie'].split(';')[0];
  assert.match(login.headers['set-cookie'], /HttpOnly.*Secure/);
  assert.equal(JSON.parse((await request('/api/admin/storage', 'GET', undefined, cookie)).body).writable, false);
  const games = await request('/api/admin/games', 'GET', undefined, cookie);
  assert.equal(games.status, 503);
  assert.match(games.body, /FIREBASE_SERVICE_ACCOUNT/);
  assert.equal((await request('/api/admin/games')).status, 401);
});

test('Firebase salva, publica, oculta e exclui entre instâncias sem mudar o login', async t => {
  const { state, credentials } = mockFirebase(t);
  process.env.FIREBASE_SERVICE_ACCOUNT = credentials;
  const login = await request('/api/login', 'POST', { password: process.env.ADMIN_PASSWORD });
  const cookie = login.headers['set-cookie'].split(';')[0];
  const game = { title: 'Jogo Firebase', category: 'Indie', platform: 'PC', description: 'Descrição', cover: '', driveUrl: 'https://drive.google.com/file/d/test/view', instructions: 'Instale.', published: false, featured: true };
  const created = await request('/api/admin/games', 'POST', game, cookie);
  assert.equal(created.status, 201);
  const { id } = JSON.parse(created.body);
  assert.equal((await firebaseStore().getGame(id)).title, game.title);
  assert.deepEqual(JSON.parse((await request('/api/games')).body), []);
  const visibility = `/api/admin/games/${id}/visibility`;
  assert.equal((await request(visibility, 'PUT', { published: true })).status, 401);
  assert.equal((await request(visibility, 'PUT', { published: true }, cookie)).status, 200);
  assert.equal(JSON.parse((await request('/api/games')).body)[0].id, id);
  assert.equal((await request(visibility, 'PUT', { published: false }, cookie)).status, 200);
  assert.deepEqual(JSON.parse((await request('/api/games')).body), []);
  assert.equal((await firebaseStore().getGame(id)).instructions, game.instructions);
  assert.equal((await request(`/api/admin/games/${id}`, 'DELETE', undefined, cookie)).status, 200);
  assert.deepEqual(await firebaseStore().games(), []);
  assert.equal(state.document.nextId, 2);
  assert.equal(state.oauthCalls, 1, 'Reutiliza o token de acesso entre requisições');
  assert.match((await request('/api/logout', 'POST')).headers['set-cookie'], /Max-Age=0/);
});

test('Firebase preserva alterações concorrentes e dados durante indisponibilidade', async t => {
  const { state, credentials } = mockFirebase(t);
  process.env.FIREBASE_SERVICE_ACCOUNT = credentials;
  state.document = { version: 1, nextId: 2, games: { 'game-1': { title: 'Original', id: 1, published: true } } };
  state.conflicts = 1;
  await firebaseStore().deleteGame(1);
  assert.equal(state.document.games['game-99'].title, 'Outra sessão');
  const saved = structuredClone(state.document);
  state.fail = true;
  await assert.rejects(firebaseStore().deleteGame(99), /Firebase/);
  assert.deepEqual(state.document, saved);
  state.fail = false;
  state.deny = true;
  await assert.rejects(firebaseStore({ publicOnly: true }).games(), /Acesso negado/);
  assert.deepEqual(state.document, saved);
});
