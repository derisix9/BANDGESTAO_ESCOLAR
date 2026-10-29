import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const readme = readFileSync('README.md', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const shards = JSON.parse(readFileSync('src/config/dataShards.json', 'utf8')).collections;

describe('documentação do projecto', () => {
  it('o package.json tem o nome do produto', () => {
    expect(pkg.name).toBe('bandmed');
  });
  it('o README não fala do que já não existe', () => {
    expect(readme).not.toMatch(/firebase/i);
    expect(readme).not.toMatch(/4 perfis/);
    expect(readme).not.toMatch(/Alternar Perfil|Restaurar Dados de F[aá]brica|Download \.SQL/);
  });
  it('o nº de colecções do README é o real', () => {
    const n = Object.keys(shards).length;
    expect(readme).toContain(`Todas as ${n} colecções do sistema`);
    expect(readme).toContain(`${n} colecções`);
  });
  it('o README fala nos 8 perfis fixos (os do tipo UserRole)', () => {
    const types = readFileSync('src/types/index.ts', 'utf8');
    const roles = /export type UserRole = ([^;]+);/.exec(types)![1].split('|').map((s) => s.trim());
    expect(roles).toHaveLength(8);
    expect(readme).toContain('8 perfis fixos');
  });
  it('os ficheiros que o README manda abrir existem', () => {
    const refs = [...readme.matchAll(/`((?:docs|src|supabase|database|scripts)\/[\w./-]+\.(?:md|ts|tsx|sql|mjs|json|sh))`/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(10);
    expect(refs.filter((f) => !existsSync(f))).toEqual([]);
  });
  it('o .env.example existe e não tem segredos', () => {
    const env = readFileSync('.env.example', 'utf8');
    expect(env).toContain('VITE_SUPABASE_URL=');
    expect(env).not.toMatch(/service_role\s*=|eyJ[A-Za-z0-9_-]{20,}/);
  });
});
