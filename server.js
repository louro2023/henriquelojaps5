import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getStore, storageStatus, ConfigurationError, ConflictError } from './lib/storage.js';
import { verifyPassword, issueSession, authenticated, attempt, resetAttempts } from './lib/auth.js';
import { PermissionError } from './lib/errors.js';

const root = path.dirname(fileURLToPath(import.meta.url));
class ValidationError extends Error {}

export function validateGame(input) {
  const game = {};
  for (const [key, max] of Object.entries({ title: 120, category: 60, platform: 40, description: 3000, cover: 2000, driveUrl: 2000, instructions: 15000 })) {
    if (typeof input[key] !== 'string' || input[key].length > max) throw new ValidationError(`Campo inválido: ${key}`);
    game[key] = input[key].trim();
  }
  if (!game.title || !game.description || !game.category || !game.platform) throw new ValidationError('Preencha os campos obrigatórios.');
  try {
    if (game.cover && new URL(game.cover).protocol !== 'https:') throw new ValidationError('A capa deve usar HTTPS.');
    if (game.driveUrl) {
      const url = new URL(game.driveUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || url.username || url.password) throw new ValidationError('Use um link HTTPS do Google Drive.');
    }
  } catch (error) {
    if (error instanceof TypeError) throw new ValidationError('URL inválida.');
    throw error;
  }
  if (input.published && !input.demo && (!game.driveUrl || !game.instructions)) throw new ValidationError('Para publicar, preencha o link do Drive e as instruções.');
  return { ...game, published: !!input.published, featured: !!input.featured, demo: !!input.demo };
}

async function readBody(req) {
  // Vercel's Node handler may provide an already-parsed body.
  let raw;
  if (req.body !== undefined) raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  else {
    raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 40000) throw new ValidationError('Conteúdo muito grande.');
    }
  }
  if (Buffer.byteLength(raw) > 40000) throw new ValidationError('Conteúdo muito grande.');
  let body;
  try { body = JSON.parse(raw || '{}'); } catch { throw new ValidationError('Dados inválidos.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Dados inválidos.');
  return body;
}

export default async function handler(req, res) {
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!pathname.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, { error: 'Método não permitido.' });
      const files = { '/': 'index.html', '/admin': 'index.html', '/styles.css': 'styles.css', '/app.js': 'app.js' };
      if (!files[pathname]) return send(404, { error: 'Página não encontrada.' });
      const file = files[pathname];
      res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
      return res.end(readFileSync(path.join(root, 'public', file)));
    }
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(403, { error: 'Origem não permitida.' });
    if (pathname === '/api/games' && req.method === 'GET') {
      const games = await getStore({ publicOnly: true }).games();
      return send(200, games.filter(game => game.published));
    }
    const token = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    if (pathname === '/api/session' && req.method === 'GET' && !token) return send(200, { authenticated: false });
    const secure = process.env.VERCEL || process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
    if (pathname === '/api/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', `session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
      return send(200, { ok: true });
    }
    const store = getStore();
    const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
    if (pathname === '/api/login' && req.method === 'POST') {
      // Vercel overwrites this header; local servers use the socket address.
      const ip = process.env.VERCEL ? String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim() : req.socket?.remoteAddress || 'unknown';
      if (attempt(ip) > 10) return send(429, { error: 'Muitas tentativas. Tente novamente em 15 minutos.' });
      if (!verifyPassword(body.password)) return send(401, { error: 'Senha incorreta.' });
      resetAttempts(ip);
      const session = issueSession();
      res.setHeader('Set-Cookie', `session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`);
      return send(200, { ok: true });
    }
    const loggedIn = authenticated(token);
    if (pathname === '/api/session' && req.method === 'GET') return send(200, { authenticated: loggedIn });
    if (!loggedIn) return send(401, { error: 'Entre na área administrativa.' });
    if (pathname === '/api/admin/storage' && req.method === 'GET') return send(200, storageStatus());
    if (pathname === '/api/admin/games' && req.method === 'GET') return send(200, await store.games());
    if (pathname === '/api/admin/games' && req.method === 'POST') {
      const game = validateGame({ ...body, demo: false });
      return send(201, { ...game, id: await store.saveGame(game) });
    }
    const visibility = pathname.match(/^\/api\/admin\/games\/(\d+)\/visibility$/);
    if (visibility && req.method === 'PUT') {
      if (typeof body.published !== 'boolean') throw new ValidationError('Informe se o jogo deve ficar público.');
      await store.setPublished(Number(visibility[1]), body.published, validateGame);
      return send(200, { ok: true });
    }
    const match = pathname.match(/^\/api\/admin\/games\/(\d+)$/);
    if (match && ['PUT', 'DELETE'].includes(req.method)) {
      const id = Number(match[1]);
      const game = await store.getGame(id);
      if (!game) return send(404, { error: 'Jogo não encontrado.' });
      if (req.method === 'DELETE') await store.deleteGame(id);
      else await store.saveGame(validateGame({ ...body, demo: game.demo && !body.driveUrl }), id);
      return send(200, { ok: true });
    }
    send(404, { error: 'Recurso não encontrado.' });
  } catch (error) {
    if (error instanceof PermissionError) return send(503, { error: error.message });
    if (error instanceof ConfigurationError) return send(503, { error: error.message });
    if (error instanceof ConflictError) return send(409, { error: error.message });
    if (error instanceof ValidationError) return send(400, { error: error.message });
    console.error('Falha ao atender requisição:', error.code || error.name);
    send(503, { error: 'Não foi possível acessar os dados da loja. Tente novamente em instantes.' });
  }
}

if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  http.createServer(handler).listen(Number(process.env.PORT) || 3000, process.env.HOST || '127.0.0.1', () => {
    console.log(`Henrique Store: http://localhost:${process.env.PORT || 3000}\nAdmin: /admin\nSenha: ADMIN_PASSWORD ou arquivo data/senha-admin.txt`);
  });
}
