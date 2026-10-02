import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { demoGames } from './demo.js';

export class ConfigurationError extends Error {}
export class ConflictError extends Error {}
export const dataDirectory = () => process.env.DATA_DIR || fileURLToPath(new URL('../data', import.meta.url));
const blobPath = 'henrique-store/catalogue.json';
const initial = () => ({ version: 1, nextId: 7, games: structuredClone(demoGames) });
const canSave = () => !process.env.VERCEL || !!process.env.BLOB_READ_WRITE_TOKEN;
export const storageStatus = () => ({ writable: canSave(), message: canSave() ? '' : 'Você já pode acessar o painel. Para salvar jogos para todos os visitantes, conecte um Vercel Blob privado em Storage e faça um novo deploy. Não é um banco de dados.' });

function parseCatalogue(text) {
  const document = JSON.parse(text);
  if (document.version !== 1 || !Array.isArray(document.games) || !Number.isSafeInteger(document.nextId)) throw new Error('Invalid catalogue');
  return document;
}

async function readCatalogue() {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { get } = await import('@vercel/blob');
    const result = await get(blobPath, { access: 'private', useCache: false });
    if (!result) return { document: initial(), etag: null };
    return { document: parseCatalogue(await new Response(result.stream).text()), etag: result.blob.etag };
  }
  if (process.env.VERCEL) return { document: initial(), etag: null };
  try { return { document: parseCatalogue(await readFile(path.join(dataDirectory(), 'catalogue.json'), 'utf8')) }; }
  catch (error) { if (error.code === 'ENOENT') return { document: initial() }; throw error; }
}

async function writeCatalogue(document, etag) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put, BlobPreconditionFailedError } = await import('@vercel/blob');
    try {
      await put(blobPath, JSON.stringify(document), {
        access: 'private', addRandomSuffix: false, contentType: 'application/json',
        allowOverwrite: !!etag, ...(etag ? { ifMatch: etag } : {}),
      });
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) throw new ConflictError('O catálogo foi atualizado por outra instância.');
      throw error;
    }
    return;
  }
  if (process.env.VERCEL) throw new ConfigurationError(storageStatus().message);
  await mkdir(dataDirectory(), { recursive: true });
  const temporary = path.join(dataDirectory(), `catalogue-${randomBytes(8).toString('hex')}.tmp`);
  await writeFile(temporary, JSON.stringify(document, null, 2));
  await rename(temporary, path.join(dataDirectory(), 'catalogue.json'));
}

let queue = Promise.resolve();
function mutate(change) {
  if (!canSave()) return Promise.reject(new ConfigurationError(storageStatus().message));
  const task = queue.then(async () => {
    for (let retry = 0; retry < 4; retry++) {
      const { document, etag } = await readCatalogue();
      const result = change(document);
      try { await writeCatalogue(document, etag); return result; }
      catch (error) {
        if (!(error instanceof ConflictError)) throw error;
      }
    }
    throw new ConflictError('Outro administrador alterou o catálogo. Recarregue e tente novamente.');
  });
  queue = task.catch(() => {});
  return task;
}

export function getStore() {
  return {
    async games() { return (await readCatalogue()).document.games.sort((a,b) => b.id-a.id); },
    async getGame(id) { return (await readCatalogue()).document.games.find(game => game.id === id) || null; },
    saveGame(game, id) {
      return mutate(document => {
        if (id) {
          const index = document.games.findIndex(game => game.id === id);
          if (index < 0) throw new ConflictError('O jogo foi excluído. Recarregue o catálogo.');
          document.games[index] = { ...game, id };
          return id;
        }
        const createdId = document.nextId++;
        document.games.push({ ...game, id: createdId });
        return createdId;
      });
    },
    setPublished(id, published, validate) {
      return mutate(document => {
        const game = document.games.find(game => game.id === id);
        if (!game) throw new ConflictError('O jogo foi excluído. Recarregue o catálogo.');
        validate({ ...game, published });
        game.published = published;
      });
    },
    deleteGame(id) { return mutate(document => { document.games = document.games.filter(game => game.id !== id); }); },
  };
}
