import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const WS_PORT = 8765;

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		proxy: {
			// REST API 프록시
			'/api': {
				target: `http://localhost:${WS_PORT}`,
				changeOrigin: true
			},
			// WebSocket 프록시
			'/ws': {
				target: `http://localhost:${WS_PORT}`,
				ws: true,
				changeOrigin: true
			}
		}
	}
});
