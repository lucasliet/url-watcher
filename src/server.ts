import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { keysFor, kv } from './kv.ts';
import { checkSiteAndMaybeNotify, type NotifyFn } from './watcher.ts';
import { notifyAdmin } from './notifier.ts';

/**
 * Cria e configura a aplicação Hono para o Url Watcher.
 *
 * Endpoints:
 * - GET / e /health:
 *   - Dispara uma verificação de conteúdo para todos os alvos monitorados.
 *   - Responde com JSON contendo um array de objetos para cada alvo:
 *     - url: string - A URL monitorada.
 *     - changed: boolean | null - Indica se o conteúdo mudou desde a última verificação.
 *     - updatedAt: string | null - Timestamp ISO da última atualização, ou null se nunca verificado.
 *   - Se updatedAt vier ausente no resultado da verificação, ele é obtido do KV.
 * - GET /robots.txt: Serve o arquivo em static/robots.txt, com fallback mínimo se não conseguir ler.
 * - /webhook: Rota reservada (sem handler); cai para o 404 padrão do Hono.
 * - Demais rotas: Respondem com uma mensagem informativa simples indicando que o watcher está em execução.
 *   Não há integração de webhook do Telegram.
 *
 * Tratamento de erros:
 * - GET / e /health retornam HTTP 500 com um objeto JSON contendo a mensagem de erro se ocorrer exceção durante o processamento.
 *
 * @param opts.notify Função de notificação injetada (default: notifyAdmin). Em testes,
 *                     passar um stub no-op para evitar disparar Telegram real.
 * @returns Instância configurada de Hono.
 */
export function createApp(opts: { notify?: NotifyFn } = {}) {
	const notify: NotifyFn = opts.notify ?? notifyAdmin;
	const app = new Hono();

	app.use('*', cors());

	// Middleware de logging
	app.use('*', async (c, next) => {
		const start = Date.now();
		await next();
		const ms = Date.now() - start;
		console.log(`${c.req.method} ${c.req.url} - ${ms}ms`);
	});

	// Middleware para servir o robots.txt
	app.get('/robots.txt', async (c) => {
		try {
			const robotsTxt = await Deno.readTextFile('./static/robots.txt');
			return c.text(robotsTxt, 200, { 'content-type': 'text/plain; charset=utf-8' });
		} catch (_error) {
			return c.text('User-agent: *\nDisallow: /', 200, { 'content-type': 'text/plain; charset=utf-8' });
		}
	});

	// `app.on` (não `app.get`) aceita múltiplos paths no segundo argumento.
	app.on('GET', ['/', '/health'], async (c) => {
		try {
			const results = await checkSiteAndMaybeNotify(notify);
			const targets = await Promise.all(results.map(async (r) => ({
				url: r.url,
				changed: r.changed,
				updatedAt: r.updatedAt ?? (await kv.get<string>(keysFor(r.url).updatedAt)).value ?? null,
			})));
			return c.json({ ok: true, targets }, 200, { 'content-type': 'application/json; charset=utf-8' });
		} catch (err) {
			return c.json({ message: err instanceof Error ? err.message : 'Unknown error occurred' }, 500);
		}
	});

	// /webhook cai propositalmente para o 404 padrão (reservado para webhook do Telegram).
	// Qualquer outra rota retorna a mensagem informativa (qualquer método HTTP).
	app.all('*', (c) => {
		if (c.req.path === '/webhook') return c.notFound();
		return c.text('Url Watcher running. Notifications only.', 200);
	});

	return app;
}
