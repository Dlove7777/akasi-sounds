import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Renderer lives in /renderer; built assets go to /renderer/dist and are loaded
// over file:// in production, so base must be relative.
export default defineConfig({
  root: path.resolve(__dirname, 'renderer'),
  base: './',
  plugins: [react()],
  server: { port: 5273, strictPort: true },
  build: { outDir: path.resolve(__dirname, 'renderer/dist'), emptyOutDir: true },
});
