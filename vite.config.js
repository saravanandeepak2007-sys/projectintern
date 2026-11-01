import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' lets the built site work on any GitHub Pages path (user.github.io/repo-name/).
export default defineConfig({ base: './', plugins: [react()] });
