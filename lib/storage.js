import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { firebaseStore, firebaseStorageStatus, useFirebase } from './firebase.js';
import { ConflictError } from './errors.js';

export { ConfigurationError, ConflictError } from './errors.js';
export const dataDirectory = () => process.env.DATA_DIR || fileURLToPath(new URL('../data', import.meta.url));
const initial = () => ({ version: 1, nextId: 1, games: [] });
export const storageStatus = () => useFirebase() ? firebaseStorageStatus() : { writable: true, message: '' };

function parseCatalogue(text) {
  const document = JSON.parse(text);
  if (document.version !== 1 || !Array.isArray(document.games) || !Number.isSafeInteger(document.nextId)) throw new Error('Invalid catalogue');
  return document;
}

async function readCatalogue() {
  try { return { document: parseCatalogue(await readFile(path.join(dataDirectory(), 'catalogue.json'), 'utf8')) }; }
  catch (error) { if (error.code === 'ENOENT') return { document: initial() }; throw error; }
}

async function writeCatalogue(document) {
  await mkdir(dataDirectory(), { recursive: true });
  const temporary = path.join(dataDirectory(), `catalogue-${randomBytes(8).toString('hex')}.tmp`);
  await writeFile(temporary, JSON.stringify(document, null, 2));
  await rename(temporary, path.join(dataDirectory(), 'catalogue.json'));
}

let queue = Promise.resolve();
function mutate(change) {
  const task = queue.then(async () => {
    const { document } = await readCatalogue();
    const result = change(document);
    await writeCatalogue(document);
    return result;
  });
  queue = task.catch(() => {});
  return task;
}

export function getStore(options) {
  if (useFirebase()) return firebaseStore(options);
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
