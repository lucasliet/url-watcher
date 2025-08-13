import { Application } from 'oak';
import { oakCors } from 'oak-cors';
import { keysFor, kv } from './kv.ts';
import { checkSiteAndMaybeNotify } from './watcher.ts';

/**
 * Cria e configura a aplicação Oak para o Url Watcher.
 *
 * Endpoints:
 * - GET / e /health:
 *   - Dispara uma verificação de conteúdo para todos os alvos monitorados.
 *   - Responde com JSON contendo um array de objetos para cada alvo:
 *     - url: string - A URL monitorada.
 *     - changed: boolean | null - Indica se o conteúdo mudou desde a última verificação.
 *     - updatedAt: string | null - Timestamp ISO da última atualização, ou null se nunca verificado.
 *   - Se updatedAt vier ausente no resultado da verificação, ele é obtido do KV.
 * - Outras rotas:
 *   - Responde com uma mensagem informativa simples indicando que o watcher está em execução.
 *   - Não há integração de webhook do Telegram.
 *
 * Tratamento de erros:
 * - Retorna HTTP 500 com um objeto JSON contendo a mensagem de erro se ocorrer exceção durante o processamento.
 *
 * @returns {Application} Instância configurada de Oak Application.
 */
export function createApp() {
	const app = new Application();
	app.use(oakCors());

	app.use(async (ctx, next) => {
		try {
			if (ctx.request.method === 'GET' && (ctx.request.url.pathname === '/' || ctx.request.url.pathname === '/health')) {
				const results = await checkSiteAndMaybeNotify();
				const targets = await Promise.all(results.map(async (r) => ({
					url: r.url,
					changed: r.changed,
					updatedAt: r.updatedAt ?? (await kv.get<string>(keysFor(r.url).updatedAt)).value ?? null,
				})));
				ctx.response.status = 200;
				ctx.response.headers.set('content-type', 'application/json; charset=utf-8');
				ctx.response.body = JSON.stringify({ ok: true, targets });
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
