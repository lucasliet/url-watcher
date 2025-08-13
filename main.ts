import { CONFIG } from '@/config.ts';
import { createApp } from '@/server.ts';
import { checkSiteAndMaybeNotify } from '@/watcher.ts';
import { log } from '@/logger.ts';

/**
 * Bootstraps the application: performs an initial check, creates the HTTP app,
 * sets up scheduling for Deno Deploy, and starts the server in local dev.
 *
 * Behavior:
 * - Always triggers an initial content check on startup.
 * - In Deno Deploy: registers a daily cron at 08:00 UTC and attaches a fetch listener.
 * - In local development: listens on the configured port for health/info endpoints.
 */
function initialize() {
	checkSiteAndMaybeNotify();

	const app = createApp();

	if (CONFIG.IS_DEPLOY) {
		Deno.cron('Url Watcher status check', '0 8 * * *', async () => {
			await checkSiteAndMaybeNotify();
		});

		addEventListener('fetch', (event: any) => {
			event.respondWith(
				app.handle(event.request).then((res) => res ?? new Response('Not Found', { status: 404 })),
			);
		});
	} else {
		app.listen({ port: CONFIG.PORT });
		log.info(`Local server listening on http://localhost:${CONFIG.PORT}`);
	}
}

initialize();
