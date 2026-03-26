import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  publicDir: 'frontend/public',
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});