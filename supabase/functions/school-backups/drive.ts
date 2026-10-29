/** Google Drive (API v3) com OAuth. Âmbito `drive.file`: a app só vê/altera os ficheiros que ELA criou. */
export const DRIVE_SCOPES = 'openid email https://www.googleapis.com/auth/drive.file';
export const DRIVE_FOLDER_NAME = 'BandMed Backups';
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export interface GoogleApp { clientId: string; clientSecret: string }
type F = typeof fetch;

async function fail(res: Response, what: string): Promise<never> {
  let m = '';
  try { const j = await res.json(); m = j?.error?.message || j?.error_description || (typeof j?.error === 'string' ? j.error : ''); } catch { /* sem JSON */ }
  const extra = res.status === 401 || /invalid_grant/i.test(m) ? ' — a ligação ao Google Drive expirou ou foi revogada; volte a ligar.'
    : res.status === 403 ? ' — sem permissão ou quota/limite do Google atingido.' : '';
  throw new Error(`Google Drive (${what}): HTTP ${res.status} ${String(m).slice(0, 160)}${extra}`);
}

export function authUrl(app: GoogleApp, redirectUri: string, state: string): string {
  const p = new URLSearchParams({ client_id: app.clientId, redirect_uri: redirectUri, response_type: 'code', scope: DRIVE_SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state });
  return `${AUTH}?${p}`;
}

export async function exchangeCode(app: GoogleApp, redirectUri: string, code: string, f: F = fetch): Promise<{ refreshToken: string; email: string }> {
  const res = await f(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
  if (!res.ok) await fail(res, 'ligação');
  const j: any = await res.json();
  if (!j.refresh_token) throw new Error('O Google não devolveu autorização permanente. Remova o acesso do BandMed em myaccount.google.com/permissions e ligue de novo.');
  let email = '';
  try { email = JSON.parse(atob(String(j.id_token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || ''; } catch { /* sem e-mail */ }
  return { refreshToken: String(j.refresh_token), email };
}

export async function accessToken(app: GoogleApp, refreshToken: string, f: F = fetch): Promise<string> {
  const res = await f(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }) });
  if (!res.ok) await fail(res, 'autorização');
  return String(((await res.json()) as any).access_token);
}

export async function revoke(refreshToken: string, f: F = fetch): Promise<void> {
  try { await f(REVOKE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refreshToken }) }); } catch { /* melhor esforço */ }
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export async function ensureFolder(token: string, knownId?: string | null, f: F = fetch): Promise<string> {
  if (knownId) {
    const r = await f(`${API}/files/${encodeURIComponent(knownId)}?fields=id,trashed`, { headers: auth(token) });
    if (r.ok) { const j: any = await r.json(); if (!j.trashed) return String(j.id); }
    else if (r.status !== 404) await fail(r, 'pasta');
  }
  const q = `name='${esc(DRIVE_FOLDER_NAME)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const s = await f(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`, { headers: auth(token) });
  if (!s.ok) await fail(s, 'pasta');
  const found = ((await s.json()) as any).files?.[0]?.id;
  if (found) return String(found);
  const c = await f(`${API}/files?fields=id`, { method: 'POST', headers: { ...auth(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }) });
  if (!c.ok) await fail(c, 'criar pasta');
  return String(((await c.json()) as any).id);
}

export async function uploadFile(token: string, folderId: string, name: string, body: Uint8Array, mime: string, f: F = fetch): Promise<string> {
  const init = await f(`${UPLOAD}/files?uploadType=resumable&fields=id`, { method: 'POST',
    headers: { ...auth(token), 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(body.byteLength) },
    body: JSON.stringify({ name, parents: [folderId] }) });
  if (!init.ok) await fail(init, 'iniciar envio');
  const loc = init.headers.get('location');
  if (!loc || !/^https:\/\/[a-z0-9.-]*googleapis\.com\//i.test(loc)) throw new Error('Google Drive: resposta de envio inesperada.');
  const put = await f(loc, { method: 'PUT', headers: { 'Content-Type': mime, 'Content-Length': String(body.byteLength) }, body: body as any });
  if (!put.ok) await fail(put, 'enviar ficheiro');
  return String(((await put.json()) as any).id);
}

export async function listFiles(token: string, folderId: string, f: F = fetch): Promise<Array<{ id: string; name: string }>> {
  const out: Array<{ id: string; name: string }> = [];
  let page = '';
  for (let i = 0; i < 100; i++) {
    const q = `'${esc(folderId)}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`;
    const r = await f(`${API}/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name)&pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`, { headers: auth(token) });
    if (!r.ok) await fail(r, 'listar');
    const j: any = await r.json();
    for (const x of j.files ?? []) out.push({ id: String(x.id), name: String(x.name) });
    if (!j.nextPageToken) break;
    page = j.nextPageToken;
  }
  return out;
}

export async function deleteFile(token: string, id: string, f: F = fetch): Promise<void> {
  const r = await f(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth(token) });
  if (!r.ok && r.status !== 404) await fail(r, 'apagar');
}
