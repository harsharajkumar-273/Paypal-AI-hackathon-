import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = `http://127.0.0.1:${process.env.PORT || env.PORT || '3001'}`;
  return {
    plugins: [react()],
    server: {
      strictPort: true,
      proxy: { '/api': target, '/fixtures': target },
    },
  };
});
