import { Application } from 'oak';
import { oakCors } from 'oak-cors';
import { keysFor, kv } from './kv.ts';
import { CONFIG } from './config.ts';

/**
 * Creates and configures the Oak application.
 *
 * Endpoints:
 * - GET / and /health: JSON status including last cache update timestamp.
 * - Other routes: simple informational response. No Telegram webhook is used.
 *
 * Returns the configured Application instance.
 */
export function createApp() {
	const app = new Application();
	app.use(oakCors());

	app.use(async (ctx, next) => {
		try {
			if (ctx.request.method === 'GET' && (ctx.request.url.pathname === '/' || ctx.request.url.pathname === '/health')) {
				const statuses = await Promise.all(
					CONFIG.TARGET_URLS.map(async (u) => ({
						url: u,
						updatedAt: (await kv.get<string>(keysFor(u).updatedAt)).value ?? null,
					})),
				);
				ctx.response.status = 200;
				ctx.response.headers.set('content-type', 'application/json; charset=utf-8');
				ctx.response.body = JSON.stringify({ ok: true, targets: statuses });
				return;
			}

			if (ctx.request.url.pathname !== '/webhook') {
				ctx.response.status = 200;
				ctx.response.body = 'Url Watcher running. Notifications only.';
				return;
			}

			await next();
		} catch (err) {
			ctx.response.status = 500;
			ctx.response.body = {
				message: err instanceof Error ? err.message : 'Unknown error occurred',
			};
		}
	});

	return app;
}
