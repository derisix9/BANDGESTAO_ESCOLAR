import path from 'path';
import {defineConfig} from 'vitest/config';

// Testes só da lógica pura (utils/*): sem plugins de React/Tailwind, rápidos e sem navegador.
export default defineConfig({
  resolve: {alias: {'@': path.resolve(__dirname, '.')}},
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
});
