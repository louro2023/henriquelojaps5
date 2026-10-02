import { createSign } from 'node:crypto';
import { ConfigurationError, ConflictError, PermissionError } from './errors.js';

// Public project identifiers. Private credentials are only read on the server.
export const firebaseConfig = Object.freeze({
  databaseURL: 'https://lojaps5-default-rtdb.firebaseio.com',
  projectId: 'lojaps5',
});
export const useFirebase = () => !!process.env.VERCEL || process.env.STORE_BACKEND === 'firebase';

let cachedAccess;
export function firebaseStorageStatus() {
  return { writable: !!process.env.FIREBASE_SERVICE_ACCOUNT, message: process.env.FIREBASE_SERVICE_ACCOUNT ? '' : 'Para salvar jogos, configure FIREBASE_SERVICE_ACCOUNT na Vercel com o JSON da conta de serviço do Firebase. O login continua usando a senha atual.' };
}

async function accessToken() {
  const credentials = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!credentials) throw new ConfigurationError(firebaseStorageStatus().message);
  if (cachedAccess?.credentials === credentials && cachedAccess.expires > Date.now() + 60000) return cachedAccess.token;
  let account;
  try { account = JSON.parse(credentials); } catch { throw new ConfigurationError('FIREBASE_SERVICE_ACCOUNT deve conter o JSON da conta de serviço do Firebase.'); }
  if (account.project_id !== firebaseConfig.projectId || !account.client_email || !account.private_key) {
    throw new ConfigurationError('Use uma conta de serviço do projeto lojaps5 em FIREBASE_SERVICE_ACCOUNT.');
  }
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`;
  let signature;
  try { signature = createSign('RSA-SHA256').update(payload).sign(account.private_key, 'base64url'); }
  catch { throw new ConfigurationError('A chave privada da conta de serviço é inválida. Confira o JSON configurado na Vercel.'); }
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${payload}.${signature}` }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new ConfigurationError('Não foi possível autenticar a conta de serviço do Firebase. Confira a credencial na Vercel.');
  cachedAccess = { credentials, token: data.access_token, expires: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cachedAccess.token;
}

async function database(location, { publicRead = false, query = {}, method = 'GET', body, etag, readEtag = false } = {}) {
  const url = new URL(`${firebaseConfig.databaseURL}/${location}.json`);
  const token = publicRead ? null : await accessToken();
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, JSON.stringify(value));
  const response = await fetch(url, {
    method, cache: 'no-store', signal: AbortSignal.timeout(10000),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(readEtag ? { 'X-Firebase-ETag': 'true' } : {}),
      ...(etag ? { 'if-match': etag } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 412) throw new ConflictError('O catálogo foi alterado em outra sessão.');
  if ([401, 403].includes(response.status)) {
    cachedAccess = undefined;
    throw new PermissionError('Acesso negado pelo Firebase. Confira as regras do banco e a permissão da conta de serviço.');
  }
  if (!response.ok) throw new ConfigurationError('Não foi possível acessar o Firebase. Tente novamente em instantes.');
  return { data: await response.json(), etag: response.headers.get('etag') };
}

const emptyCatalogue = () => ({ version: 1, nextId: 1, games: {} });
function catalogue(data) {
  if (data === null) return emptyCatalogue();
  if (data.version !== 1 || !Number.isSafeInteger(data.nextId) || data.nextId < 1 || (data.games != null && typeof data.games !== 'object')) {
    throw new ConfigurationError('O catálogo do Firebase tem um formato inválido.');
  }
  return { ...data, games: data.games || {} };
}

export function firebaseStore({ publicOnly = false } = {}) {
  async function mutate(change) {
    if (publicOnly) throw new PermissionError('Entre na área administrativa.');
    for (let retry = 0; retry < 4; retry++) {
      const result = await database('catalogue', { readEtag: true });
      if (!result.etag) throw new ConfigurationError('Não foi possível verificar a versão do catálogo. Tente novamente.');
      const document = catalogue(result.data);
      const value = change(document);
      try {
        await database('catalogue', { method: 'PUT', body: document, etag: result.etag });
        return value;
      } catch (error) { if (!(error instanceof ConflictError)) throw error; }
    }
    throw new ConflictError('Outro administrador alterou o catálogo. Recarregue e tente novamente.');
  }
  return {
    async games() {
      const { data } = await database('catalogue/games', { publicRead: publicOnly, query: publicOnly ? { orderBy: 'published', equalTo: true } : {} });
      return Object.values(data || {}).filter(Boolean).filter(game => !publicOnly || game.published === true).sort((a, b) => b.id - a.id);
    },
    async getGame(id) {
      if (publicOnly) throw new PermissionError('Entre na área administrativa.');
      return (await database(`catalogue/games/game-${id}`)).data;
    },
    saveGame(game, id) {
      return mutate(document => {
        if (id && !document.games[`game-${id}`]) throw new ConflictError('O jogo foi excluído. Recarregue o catálogo.');
        const gameId = id || document.nextId++;
        document.games[`game-${gameId}`] = { ...game, id: gameId };
        return gameId;
      });
    },
    setPublished(id, published, validate) {
      return mutate(document => {
        const game = document.games[`game-${id}`];
        if (!game) throw new ConflictError('O jogo foi excluído. Recarregue o catálogo.');
        validate({ ...game, published });
        game.published = published;
      });
    },
    deleteGame(id) { return mutate(document => { delete document.games[`game-${id}`]; }); },
  };
}
