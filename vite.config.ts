/// <reference types="vitest" />
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './vitest.setup.ts',
        coverage: {
          provider: 'v8',
          include: ['**/*.{ts,tsx}'],
          exclude: [
            '**/*.test.*',
            '**/*.d.ts',
            'functions/**',
            'dist/**',
            '**/*.config.*',
            'vitest.setup.ts',
          ],
        },
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      // In production builds, tree-shake noisy debug logging while keeping
      // console.warn and console.error (they carry real diagnostics).
      esbuild: command === 'build' ? {
        pure: ['console.log', 'console.debug', 'console.info'],
      } : {},
      build: {
        sourcemap: 'hidden',
        rollupOptions: {
          output: {
            manualChunks: {
              'vendor-react': ['react', 'react-dom', 'react-router-dom'],
              'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/functions', 'firebase/messaging'],
              'vendor-ai': ['@google/genai'],
              'vendor-charts': ['recharts'],
              'vendor-motion': ['framer-motion'],
              'vendor-icons': ['lucide-react'],
              'vendor-utils': ['date-fns', 'clsx', 'tailwind-merge', 'react-hot-toast']
            }
          }
        }
      }
    };
});
