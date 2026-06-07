import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Express server runs Vite in middleware mode (single process on one port),
// so no dev server / port / proxy config is needed here — just the React plugin.
export default defineConfig({
  plugins: [react()],
});
