import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Strikte Content-Security-Policy nur im Build (Electron/Produktion):
// Der Vite-Dev-Server braucht Inline-Skripte für HMR, der fertige Build nicht.
// Damit ist technisch garantiert, dass die App nie nach außen telefoniert.
const cspPlugin = () => ({
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml() {
    return [{
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' data: blob:; worker-src 'self' blob:;",
      },
      injectTo: 'head-prepend',
    }];
  },
})

export default defineConfig({
  plugins: [react(), cspPlugin()],
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild'
  },
  server: {
    port: 5173,
    strictPort: true,
  }
})
