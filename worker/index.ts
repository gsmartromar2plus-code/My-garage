interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  APP_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
  ASSETS: Fetcher;
}
type User = { id: string; email: string; name: string | null; avatar_url: string | null };
const json = (data: unknown, status = 200, headers: HeadersInit = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const random = (n = 32) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return [...b].map(x => x.toString(16).padStart(2, '0')).join(''); };
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, '0')).join('');
const cookie = (name: string, value: string, maxAge: number) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const clearCookie = (name: string) => `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
function getCookie(req: Request, name: string) { return (req.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1) || ''; }
function safeOrigin(req: Request, env: Env) { return req.headers.get('Origin') === env.APP_ORIGIN && new URL(req.url).origin === env.APP_ORIGIN; }
async function body(req: Request, max = 5_000_000) { const raw = await req.text(); if (raw.length > max) throw new Error('Завеликий запит'); return JSON.parse(raw); }
async function currentUser(req: Request, env: Env): Promise<User | null> {
  const token = getCookie(req, 'mg_session'); if (!token) return null;
  const row = await env.DB.prepare(`SELECT u.id,u.email,u.name,u.avatar_url FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha(token), Date.now()).first<User>();
  return row || null;
}
async function createSession(userId: string, env: Env) {
  const token = random(32), expires = Date.now() + 30 * 86400_000;
  await env.DB.prepare('INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), userId, await sha(token), expires, Date.now()).run();
  return token;
}
async function userFromGoogle(profile: any, env: Env): Promise<User> {
  if (!profile?.email || !(profile.email_verified ?? profile.verified_email)) throw new Error('Google не підтвердив адресу електронної пошти');
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO users(id,email,name,avatar_url,created_at) VALUES(?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,avatar_url=excluded.avatar_url`).bind(id, String(profile.email).toLowerCase(), profile.name || null, profile.picture || null, Date.now()).run();
  return (await env.DB.prepare('SELECT id,email,name,avatar_url FROM users WHERE email=?').bind(String(profile.email).toLowerCase()).first<User>())!;
}
async function sendMagicLink(email: string, url: string, env: Env) {
  const result = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.EMAIL_FROM, to: [email], subject: 'Вхід до MY GARAGE', html: `<p>Щоб увійти до MY GARAGE, відкрийте посилання:</p><p><a href="${url}">Увійти до MY GARAGE</a></p><p>Посилання діє 15 хвилин. Якщо ви не запитували вхід — проігноруйте лист.</p>` }) });
  if (!result.ok) throw new Error('Не вдалося надіслати лист для входу');
}
async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url), path = url.pathname;
  if (!path.startsWith('/api/')) return env.ASSETS.fetch(req);
  if (path.startsWith('/api/') && req.method !== 'GET' && !safeOrigin(req, env)) return json({ error: 'Недозволене джерело запиту' }, 403);
  if (path === '/api/auth/me' && req.method === 'GET') return json({ user: await currentUser(req, env) });
  if (path === '/api/auth/email/request' && req.method === 'POST') {
    const { email } = await body(req, 10_000); const normalized = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return json({ error: 'Вкажіть коректну електронну пошту' }, 400);
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM magic_links WHERE email=? AND created_at>?').bind(normalized, Date.now() - 60 * 60_000).first<{n:number;last:number|null}>();
    if ((recent?.n || 0) >= 5 || (recent?.last && Date.now() - recent.last < 60_000)) return json({ error: 'Забагато запитів. Спробуйте пізніше.' }, 429);
    const token = random(32), expires = Date.now() + 15 * 60_000;
    await env.DB.prepare('INSERT INTO magic_links(id,email,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), normalized, await sha(token), expires, Date.now()).run();
    await sendMagicLink(normalized, `${env.APP_ORIGIN}/api/auth/email/verify?token=${token}`, env);
    return json({ ok: true, message: 'Посилання для входу надіслано на пошту' });
  }
  if (path === '/api/auth/email/verify' && req.method === 'GET') {
    const token = url.searchParams.get('token') || '', hash = await sha(token);
    const link = await env.DB.prepare('SELECT id,email FROM magic_links WHERE token_hash=? AND expires_at>? AND used_at IS NULL').bind(hash, Date.now()).first<{id:string;email:string}>();
    if (!link) return new Response('Посилання недійсне або вже використане. Запросіть нове.', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    await env.DB.prepare('UPDATE magic_links SET used_at=? WHERE id=? AND used_at IS NULL').bind(Date.now(), link.id).run();
    const id = crypto.randomUUID(); await env.DB.prepare('INSERT INTO users(id,email,created_at) VALUES(?,?,?) ON CONFLICT(email) DO NOTHING').bind(id, link.email, Date.now()).run();
    const user = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(link.email).first<{id:string}>();
    const session = await createSession(user!.id, env);
    return new Response(null, { status: 302, headers: { Location: `${env.APP_ORIGIN}/`, 'Set-Cookie': cookie('mg_session', session, 30 * 86400) } });
  }
  if (path === '/api/auth/google/start' && req.method === 'GET') {
    const state = random(24), redirect = `${env.APP_ORIGIN}/api/auth/google/callback`;
    const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    target.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' }).toString();
    return new Response(null, { status: 302, headers: { Location: target.toString(), 'Set-Cookie': `mg_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } });
  }
  if (path === '/api/auth/google/callback' && req.method === 'GET') {
    const state = url.searchParams.get('state') || '', expected = getCookie(req, 'mg_oauth_state'), code = url.searchParams.get('code') || '';
    if (!state || state !== expected || !code) return json({ error: 'Перевірка входу Google не пройдена' }, 400, { 'Set-Cookie': clearCookie('mg_oauth_state') });
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${env.APP_ORIGIN}/api/auth/google/callback`, grant_type: 'authorization_code' }) });
    const tokenData: any = await tokenRes.json(); if (!tokenRes.ok || !tokenData.access_token) return json({ error: 'Google не підтвердив вхід' }, 400);
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    if (!profileRes.ok) return json({ error: 'Не вдалося отримати профіль Google' }, 400);
    const user = await userFromGoogle(await profileRes.json(), env), session = await createSession(user.id, env);
    const headers = new Headers({ Location: `${env.APP_ORIGIN}/` }); headers.append('Set-Cookie', cookie('mg_session', session, 30 * 86400)); headers.append('Set-Cookie', clearCookie('mg_oauth_state')); return new Response(null, { status: 302, headers });
  }
  if (path === '/api/auth/logout' && req.method === 'POST') {
    const token = getCookie(req, 'mg_session'); if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': clearCookie('mg_session') });
  }
  const user = await currentUser(req, env);
  if (path.startsWith('/api/') && !user) return json({ error: 'Потрібно увійти до облікового запису' }, 401);
  if (path === '/api/garage' && req.method === 'GET') {
    const row = await env.DB.prepare('SELECT data,revision FROM garages WHERE user_id=?').bind(user!.id).first<{data:string;revision:number}>();
    return json({ data: row ? JSON.parse(row.data) : null, revision: row?.revision || 0 });
  }
  if (path === '/api/garage' && req.method === 'PUT') {
    const input = await body(req); const data = input.data;
    if (!data || !Array.isArray(data.vehicles) || !Array.isArray(data.carRecords)) return json({ error: 'Некоректні дані гаража' }, 400);
    const current = await env.DB.prepare('SELECT revision FROM garages WHERE user_id=?').bind(user!.id).first<{revision:number}>();
    const revision = current?.revision || 0;
    if (input.revision !== revision) return json({ error: 'Дані змінено в іншій вкладці. Експортуйте копію та оновіть сторінку.' }, 409);
    const next = revision + 1, serialized = JSON.stringify(data);
    if (current) {
      const result = await env.DB.prepare('UPDATE garages SET data=?,revision=?,updated_at=? WHERE user_id=? AND revision=?').bind(serialized, next, Date.now(), user!.id, revision).run();
      if (!result.meta.changes) return json({ error: 'Конфлікт паралельного збереження. Оновіть сторінку.' }, 409);
    } else await env.DB.prepare('INSERT INTO garages(user_id,data,revision,updated_at) VALUES(?,?,?,?)').bind(user!.id, serialized, next, Date.now()).run();
    await env.DB.prepare('INSERT INTO garage_revisions(id,user_id,revision,data,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), user!.id, next, serialized, Date.now()).run();
    return json({ revision: next });
  }
  if (path === '/api/file' && req.method === 'POST') {
    const raw = await req.text(); if (raw.length > 4_500_000 || !/^data:(image\/(jpeg|png|webp|gif)|application\/pdf);base64,[A-Za-z0-9+/=\s]+$/.test(raw)) return json({ error: 'Формат або розмір вкладення не підтримується' }, 400);
    const key = `${user!.id}/${await sha(raw)}`; const mime = raw.match(/^data:([^;]+);base64,/)?.[1] || 'application/octet-stream'; await env.MEDIA.put(key, raw, { httpMetadata: { contentType: 'text/plain; charset=utf-8', cacheControl: 'private, no-store', contentDisposition: `inline; filename="${mime}"` } }); return json({ __mgAttachment: key });
  }
  if (path === '/api/file' && req.method === 'GET') {
    const key = url.searchParams.get('key') || ''; if (!key.startsWith(`${user!.id}/`) || !/^[\w-]+\/[a-f0-9]{64}$/.test(key)) return new Response(null, { status: 404 });
    const obj = await env.MEDIA.get(key); if (!obj) return new Response(null, { status: 404 }); return new Response(await obj.text(), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' } });
  }
  if (path === '/api/blog' && req.method === 'GET') {
    const mine = url.searchParams.get('mine') === '1';
    const rows = mine ? await env.DB.prepare('SELECT id,author_id,title,content,visibility,media_json,created_at,updated_at FROM blog_posts WHERE author_id=? ORDER BY updated_at DESC').bind(user!.id).all() : await env.DB.prepare("SELECT id,author_id,title,content,visibility,media_json,created_at,updated_at FROM blog_posts WHERE visibility='public' ORDER BY created_at DESC LIMIT 100").all();
    return json({ posts: rows.results.map((r: any) => ({ ...r, media: JSON.parse(r.media_json || '[]'), media_json: undefined })) });
  }
  if (path === '/api/blog' && req.method === 'POST') {
    const x = await body(req, 1_000_000), title = String(x.title || '').trim(), content = String(x.content || ''), visibility = x.visibility === 'public' ? 'public' : 'private', media = Array.isArray(x.media) ? x.media : [];
    if (!title || title.length > 160 || content.length > 50_000 || media.length > 20) return json({ error: 'Перевірте назву, текст і вкладення допису' }, 400);
    const id = crypto.randomUUID(), now = Date.now();
    await env.DB.prepare('INSERT INTO blog_posts(id,author_id,title,content,visibility,media_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id, user!.id, title, content, visibility, JSON.stringify(media), now, now).run(); return json({ id }, 201);
  }
  const blogMatch = path.match(/^\/api\/blog\/([\w-]+)$/);
  if (blogMatch && req.method === 'PATCH') {
    const x = await body(req, 1_000_000), visibility = x.visibility === 'public' ? 'public' : 'private';
    const result = await env.DB.prepare('UPDATE blog_posts SET title=?,content=?,visibility=?,media_json=?,updated_at=? WHERE id=? AND author_id=?').bind(String(x.title || '').trim().slice(0,160), String(x.content || '').slice(0,50000), visibility, JSON.stringify(Array.isArray(x.media) ? x.media.slice(0,20) : []), Date.now(), blogMatch[1], user!.id).run();
    return result.meta.changes ? json({ ok: true }) : json({ error: 'Допис не знайдено' }, 404);
  }
  if (blogMatch && req.method === 'DELETE') {
    const result = await env.DB.prepare('DELETE FROM blog_posts WHERE id=? AND author_id=?').bind(blogMatch[1], user!.id).run(); return result.meta.changes ? json({ ok: true }) : json({ error: 'Допис не знайдено' }, 404);
  }
  const mediaMatch = path.match(/^\/api\/blog\/([\w-]+)\/media\/([\w-]+)$/);
  if (mediaMatch && req.method === 'GET') {
    const post = await env.DB.prepare('SELECT author_id,visibility,media_json FROM blog_posts WHERE id=?').bind(mediaMatch[1]).first<any>();
    if (!post || (post.visibility !== 'public' && post.author_id !== user!.id)) return new Response(null, { status: 404 });
    const refs = JSON.parse(post.media_json || '[]'); if (!refs.some((m: any) => m.key === mediaMatch[2])) return new Response(null, { status: 404 });
    const obj = await env.MEDIA.get(`${post.author_id}/${mediaMatch[2]}`); if (!obj) return new Response(null, { status: 404 }); const encoded = await obj.text(), match = encoded.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/); if (!match) return new Response(null, { status: 415 }); const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)); return new Response(bytes, { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': match[1] } });
  }
  return json({ error: 'Маршрут не знайдено' }, 404);
}
export default { async fetch(req: Request, env: Env): Promise<Response> { try { return await handle(req, env); } catch (e) { return json({ error: e instanceof Error ? e.message : 'Внутрішня помилка' }, 500); } } };
