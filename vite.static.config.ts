import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({ plugins: [react()], base: './', resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } }, build: { outDir: 'dist' }, server: { host: '127.0.0.1', port: 5173, strictPort: true } });
