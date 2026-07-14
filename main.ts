import { CONFIG } from '@/config.ts';
import { createApp } from '@/server.ts';
import { checkSiteAndMaybeNotify } from '@/watcher.ts';
import { log } from '@/logger.ts';

/**
 * Inicializa a aplicação: cria o app HTTP e o serve via Deno.serve().
 *
 * O novo Deno Deploy exige que o servidor HTTP esteja totalmente inicializado
 * antes de rotear tráfego (fase de "warmup"); Deno.serve() é a API que satisfaz
 * esse requisito tanto em Deploy quanto em desenvolvimento local. O padrão
 * legacy addEventListener('fetch') não passa na fase de warmup — ver
 * llm-telegram-bot commit 5f70409 para o mesmo fix em projeto paralelo.
 *
 * Comportamento:
 * - Não há verificação automática na inicialização; as verificações ocorrem
 *   quando GET / ou /health é chamado.
 * - Deno.cron permanece desativado (commit 1fab2d4).
 */
function initialize() {
	const app = createApp();

	// Deno.cron('Url Watcher status check', '0 8 * * *', async () => {
	// 	await checkSiteAndMaybeNotify();
	// });

	// Deno.serve é usado em ambos os caminhos (Deploy e local). O novo Deno Deploy
	// detecta Deno.serve() e o conecta ao runtime; a porta é ignorada em Deploy.
	Deno.serve({ port: CONFIG.PORT }, app.fetch);

	if (!CONFIG.IS_DEPLOY) {
		log.info(`Local server listening on http://localhost:${CONFIG.PORT}`);
	}
}

initialize();
