import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { projectStoragePlugin } from './server/projectStorage.ts';

export default defineConfig({
  plugins: [react(), projectStoragePlugin()],
  server: { fs: { deny: ['.env', '.env.*', '**/*.{crt,pem}', '**/.git/**', '**/project-files/**', '**/test-project-files/**'] } },
  appType: 'mpa',
});
