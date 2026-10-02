import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const data = process.env.DATA_DIR || path.join(root, 'data');
mkdirSync(data, { recursive: true });
const db = new DatabaseSync(path.join(data, 'store.db'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
let credentials = db.prepare("SELECT value FROM settings WHERE key='admin'").get();
if (!credentials) {
  const password = process.env.ADMIN_PASSWORD || randomBytes(15).toString('base64url');
  if (password.length < 12) throw new Error('ADMIN_PASSWORD precisa ter pelo menos 12 caracteres.');
  const salt = randomBytes(16).toString('hex');
  credentials = { value: JSON.stringify({ salt, hash: scryptSync(password, salt, 64).toString('hex') }) };
  db.prepare('INSERT INTO settings VALUES (?,?)').run('admin', credentials.value);
  if (!process.env.ADMIN_PASSWORD) writeFileSync(path.join(data, 'senha-admin.txt'), password, { mode: 0o600 });
}
const admin = JSON.parse(credentials.value);
const sessions = new Map();
const attempts = new Map();
const demo = [
  ['Cyberpunk 2077','RPG','1091500','Night City está esperando por você. Explore uma metrópole onde suas escolhas mudam tudo.'],
  ['God of War','Ação e aventura','1593500','Uma jornada épica por terras nórdicas ao lado de Kratos e Atreus.'],
  ['Forza Horizon 5','Corrida','1551360','Descubra paisagens incríveis em uma aventura automobilística de mundo aberto.'],
  ['Hogwarts Legacy','RPG','990080','Viva sua própria história em um mundo repleto de magia e descobertas.'],
  ['Red Dead Redemption 2','Ação e aventura','1174180','Explore o velho oeste em uma história inesquecível.'],
  ['Hollow Knight','Indie','367520','Desvende um reino subterrâneo em uma aventura desenhada à mão.']
];
if (!db.prepare("SELECT value FROM settings WHERE key='seeded'").get()) {
  for (const [title, category, app, description] of demo) db.prepare('INSERT INTO games(body) VALUES (?)').run(JSON.stringify({title,category,platform:'PC',description,cover:`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${app}/header.jpg`,driveUrl:'',instructions:'',published:true,featured:app==='1091500',demo:true}));
  db.prepare('INSERT INTO settings VALUES (?,?)').run('seeded','1');
}
function games() { return db.prepare('SELECT * FROM games ORDER BY id DESC').all().map(row=>({ ...JSON.parse(row.body), id:row.id })); }
export function validateGame(input) {
  const game = {};
  for (const [key,max] of Object.entries({title:120,category:60,platform:40,description:3000,cover:2000,driveUrl:2000,instructions:15000})) {
    if (typeof input[key] !== 'string' || input[key].length > max) throw new Error(`Campo inválido: ${key}`);
    game[key] = input[key].trim();
  }
  if (!game.title || !game.description || !game.category || !game.platform) throw new Error('Preencha os campos obrigatórios.');
  if (game.cover) { const url = new URL(game.cover); if(url.protocol!=='https:') throw new Error('A capa deve usar HTTPS.'); }
  if (game.driveUrl) { const url = new URL(game.driveUrl); if(url.protocol!=='https:' || url.hostname!=='drive.google.com' || url.username || url.password) throw new Error('Use um link HTTPS do Google Drive.'); }
  if(input.published && !input.demo && (!game.driveUrl || !game.instructions)) throw new Error('Para publicar, preencha o link do Drive e as instruções.');
  return {...game,published:!!input.published,featured:!!input.featured,demo:!!input.demo};
}
const server = http.createServer(async(req,res)=>{
  const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try {
    const pathname = new URL(req.url,'http://localhost').pathname;
    if (!pathname.startsWith('/api/')) {
      if(req.method!=='GET' && req.method!=='HEAD') return send(405,{error:'Método não permitido.'});
      const files={'/':'index.html','/admin':'index.html','/styles.css':'styles.css','/app.js':'app.js'};
      if(!files[pathname]) return send(404,{error:'Página não encontrada.'});
      const file=files[pathname]; res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html; charset=utf-8');
      return res.end(readFileSync(path.join(root,'public',file)));
    }
    if (!['GET','HEAD'].includes(req.method) && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(403,{error:'Origem não permitida.'});
    const token = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.cookie||'')?.[1];
    const authenticated = sessions.has(token) && sessions.get(token)>Date.now();
    let body={};
    if(['POST','PUT'].includes(req.method)) {
      let raw=''; for await(const chunk of req){raw+=chunk;if(raw.length>40000)return send(413,{error:'Conteúdo muito grande.'});}
      try{body=JSON.parse(raw||'{}');}catch{return send(400,{error:'Dados inválidos.'});}
    }
    if(pathname==='/api/login' && req.method==='POST') {
      const ip=req.socket.remoteAddress; const attempt=attempts.get(ip)||{count:0,until:Date.now()+900000};
      if(attempt.until<Date.now()){attempt.count=0;attempt.until=Date.now()+900000;}
      if(attempt.count>=10)return send(429,{error:'Muitas tentativas. Tente novamente em 15 minutos.'});
      attempt.count++;attempts.set(ip,attempt);
      if(typeof body.password!=='string' || body.password.length>256 || !timingSafeEqual(scryptSync(body.password,admin.salt,64),Buffer.from(admin.hash,'hex')))return send(401,{error:'Senha incorreta.'});
      attempts.delete(ip); const session=randomBytes(32).toString('hex');sessions.set(session,Date.now()+28800000);
      res.setHeader('Set-Cookie',`session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE==='true'?'; Secure':''}`);return send(200,{ok:true});
    }
    if(pathname==='/api/session')return send(200,{authenticated});
    if(pathname==='/api/logout' && req.method==='POST'){sessions.delete(token);res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(200,{ok:true});}
    if(pathname==='/api/games' && req.method==='GET')return send(200,games().filter(g=>g.published));
    if(!authenticated)return send(401,{error:'Entre na área administrativa.'});
    if(pathname==='/api/admin/games' && req.method==='GET')return send(200,games());
    if(pathname==='/api/admin/games' && req.method==='POST') {const game=validateGame({...body,demo:false});const result=db.prepare('INSERT INTO games(body) VALUES (?)').run(JSON.stringify(game));return send(201,{...game,id:Number(result.lastInsertRowid)});}
    const match=pathname.match(/^\/api\/admin\/games\/(\d+)$/);
    if(match && ['PUT','DELETE'].includes(req.method)) {
      const row=db.prepare('SELECT * FROM games WHERE id=?').get(Number(match[1]));if(!row)return send(404,{error:'Jogo não encontrado.'});
      if(req.method==='DELETE')db.prepare('DELETE FROM games WHERE id=?').run(Number(match[1]));
      else {const game=validateGame({...body,demo:JSON.parse(row.body).demo && !body.driveUrl});db.prepare('UPDATE games SET body=? WHERE id=?').run(JSON.stringify(game),Number(match[1]));}
      return send(200,{ok:true});
    }
    send(404,{error:'Recurso não encontrado.'});
  } catch(error){send(error instanceof TypeError || /Campo|Preencha|HTTPS|Drive|publicar/.test(error.message)?400:500,{error:error instanceof TypeError?'URL ou dados inválidos.':error.message});}
});
if(process.env.NODE_ENV!=='test') server.listen(Number(process.env.PORT)||3000,process.env.HOST||'127.0.0.1',()=>console.log(`Henrique Store: http://localhost:${process.env.PORT||3000}\nAdmin: /admin\nSenha inicial: variável ADMIN_PASSWORD ou arquivo data/senha-admin.txt`));
