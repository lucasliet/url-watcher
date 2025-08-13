import { CONFIG } from '@/config.ts';
import { createApp } from '@/server.ts';
import { checkSiteAndMaybeNotify } from '@/watcher.ts';
import { log } from '@/logger.ts';

/**
 * Inicializa a aplicação: cria o app HTTP, configura o agendamento no Deno Deploy
 * e inicia o servidor em desenvolvimento local.
 *
 * Comportamento:
 * - Não há verificação automática na inicialização; as verificações ocorrem quando GET / ou /health é chamado.
 * - Em Deno Deploy: registra um cron diário às 08:00 UTC e anexa um listener de fetch.
 * - Em desenvolvimento local: escuta na porta configurada para os endpoints de health/info.
 */
function initialize() {
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
