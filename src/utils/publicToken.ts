/**
 * Token público de uma pessoa (aluno / docente / funcionário) para os QR e códigos de barras.
 * É um hash com segredo da instituição (`settings.publicVerifySecret`): não se adivinha a partir do ID,
 * e é sempre o mesmo para a mesma pessoa (todos os cartões dela partilham o token).
 */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export const TOKEN_LEN = 10;

export function personToken(secret: string, key: string): string {
  if (!secret || !key) return '';
  const s = (cyrb53(`${secret}|${key}`, 1).toString(36) + cyrb53(`${key}|${secret}`, 7).toString(36)).replace(/[^0-9a-z]/g, '');
  return s.slice(0, TOKEN_LEN).padEnd(TOKEN_LEN, '0');
}

export function newPublicSecret(): string {
  const a = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(a);
  else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const isToken = (s: string): boolean => new RegExp(`^[0-9a-z]{${TOKEN_LEN}}$`).test(s || '');
