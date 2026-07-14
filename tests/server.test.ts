import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { createApp } from '@/server.ts';
import { CONFIG } from '@/config.ts';
import { keysFor, kv } from '@/kv.ts';
import type { NotifyFn } from '@/watcher.ts';

const SAMPLE_HTML = `<html><head><title>Página</title></head><body><h1>Conteúdo estável</h1><p>v1</p></body></html>`;

/**
 * Stub no-op para NotifyFn: nunca dispara Telegram real, nem mesmo quando o
 * ambiente de teste tiver TELEGRAM_CHAT_BOT_TOKEN configurado.
 * Em testes que precisam verificar que notify foi chamado, use `captureNotify`.
 */
const noopNotify: NotifyFn = (_message: string) => Promise.resolve();

/**
 * Cria um stub de NotifyFn que registra todas as mensagens recebidas.
 * Retorna o stub e o array capturado (mutado a cada chamada).
 */
function captureNotify(): { notify: NotifyFn; calls: string[] } {
	const calls: string[] = [];
	const notify: NotifyFn = (message: string) => {
		calls.push(message);
		return Promise.resolve();
	};
	return { notify, calls };
}

/**
 * Substitui globalThis.fetch por um stub que responde com SAMPLE_HTML para qualquer URL.
 * Retorna função para restaurar o fetch original.
 */
function stubFetch(html: string = SAMPLE_HTML): () => void {
	const original = globalThis.fetch;
	globalThis.fetch = ((input: string | URL | Request, _init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		return Promise.resolve(
			new Response(html, {
				status: 200,
				headers: { 'content-type': 'text/html; charset=utf-8', 'x-stub-url': url },
			}),
		);
	}) as typeof fetch;
	return () => {
		globalThis.fetch = original;
	};
}

/**
 * Limpa o cache KV para todas as URLs configuradas (evita interferência entre testes).
 */
async function clearWatchedUrls() {
	for (const url of CONFIG.TARGET_URLS) {
		const k = keysFor(url);
		await kv.atomic().delete(k.content).delete(k.hash).delete(k.updatedAt).commit();
	}
}

Deno.test({
	name: 'createApp: retorna instância Hono com método fetch',
	sanitizeOps: false,
	sanitizeResources: false,
	fn() {
		const app = createApp({ notify: noopNotify });
		assert(typeof app.fetch === 'function', 'app deve expor fetch');
	},
});

Deno.test({
	name: 'GET /webhook: retorna 404 (rota reservada sem handler)',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		const app = createApp({ notify: noopNotify });
		const res = await app.request('http://localhost/webhook');
		assertEquals(res.status, 404);
	},
});

Deno.test({
	name: 'GET /unknown: retorna 200 com mensagem informativa',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		const app = createApp({ notify: noopNotify });
		const res = await app.request('http://localhost/qualquer-outro-caminho');
		assertEquals(res.status, 200);
		const body = await res.text();
		assertStringIncludes(body, 'Url Watcher running');
	},
});

Deno.test({
	name: 'POST /unknown: métodos não-GET também retornam a mensagem informativa',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		const app = createApp({ notify: noopNotify });
		const res = await app.request('http://localhost/x', { method: 'POST' });
		assertEquals(res.status, 200);
		assertStringIncludes(await res.text(), 'Url Watcher running');
	},
});

Deno.test({
	name: 'GET /robots.txt: serve o arquivo em static/robots.txt',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		const app = createApp({ notify: noopNotify });
		const res = await app.request('http://localhost/robots.txt');
		assertEquals(res.status, 200);
		assertEquals(res.headers.get('content-type'), 'text/plain; charset=utf-8');
		const body = await res.text();
		assertStringIncludes(body, 'User-agent: *', 'robots.txt deve conter ao menos a regra default');
		assertStringIncludes(body, 'GPTBot', 'robots.txt do repo bloqueia GPTBot');
	},
});

Deno.test({
	name: 'GET /: dispara verificação e retorna JSON com targets (cache init) — notify não chamado',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		await clearWatchedUrls();
		const restore = stubFetch();
		const { notify, calls } = captureNotify();
		try {
			const app = createApp({ notify });
			const res = await app.request('http://localhost/');
			assertEquals(res.status, 200);
			assertEquals(res.headers.get('content-type'), 'application/json; charset=utf-8');

			const json = await res.json() as { ok: boolean; targets: Array<{ url: string; changed: boolean | null; updatedAt: string | null }> };
			assertEquals(json.ok, true);
			assert(Array.isArray(json.targets), 'targets deve ser array');
			assertEquals(json.targets.length, CONFIG.TARGET_URLS.length, 'targets deve ter uma entrada por URL configurada');

			for (const t of json.targets) {
				assert(CONFIG.TARGET_URLS.includes(t.url), `target.url ${t.url} deve estar em CONFIG.TARGET_URLS`);
				assertEquals(t.changed, null, 'primeira verificação deve reportar changed=null (cache init)');
				assert(t.updatedAt, 'updatedAt deve estar presente após inicialização do cache');
			}

			// Cache init NÃO dispara notificação (só muda/changed dispara).
			assertEquals(calls.length, 0, 'notify não deve ser chamado em cache init');
		} finally {
			restore();
			await clearWatchedUrls();
		}
	},
});

Deno.test({
	name: 'GET /health: mesma forma que GET / (verificação + JSON)',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		await clearWatchedUrls();
		const restore = stubFetch();
		try {
			const app = createApp({ notify: noopNotify });
			const res = await app.request('http://localhost/health');
			assertEquals(res.status, 200);
			const json = await res.json() as { ok: boolean; targets: unknown[] };
			assertEquals(json.ok, true);
			assert(Array.isArray(json.targets));
		} finally {
			restore();
			await clearWatchedUrls();
		}
	},
});

Deno.test({
	name: 'GET / duas vezes com conteúdo igual: segunda chamada reporta changed=false — notify não chamado',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		await clearWatchedUrls();
		const restore = stubFetch();
		const { notify, calls } = captureNotify();
		try {
			const app = createApp({ notify });

			// Primeira chamada inicializa cache.
			await app.request('http://localhost/');

			// Segunda chamada com mesmo conteúdo deve reportar unchanged.
			const res2 = await app.request('http://localhost/');
			assertEquals(res2.status, 200);
			const json = await res2.json() as { targets: Array<{ changed: boolean | null }> };
			for (const t of json.targets) {
				assertEquals(t.changed, false, 'segunda verificação com conteúdo idêntico deve reportar changed=false');
			}

			// Nem init nem unchanged disparam notificação.
			assertEquals(calls.length, 0, 'notify não deve ser chamado quando conteúdo não muda');
		} finally {
			restore();
			await clearWatchedUrls();
		}
	},
});

Deno.test({
	name: 'GET / detecta mudança quando conteúdo difere entre chamadas — notify chamado uma vez por URL',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		await clearWatchedUrls();
		const restore = stubFetch(`<body>v1</body>`);
		const { notify, calls } = captureNotify();
		try {
			const app = createApp({ notify });
			await app.request('http://localhost/'); // init cache

			// Troca o stub para retornar conteúdo diferente.
			globalThis.fetch = ((input: string | URL | Request, _init?: RequestInit) => {
				const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
				return Promise.resolve(
					new Response(`<body>v2 modificado</body>`, {
						status: 200,
						headers: { 'content-type': 'text/html', 'x-stub-url': url },
					}),
				);
			}) as typeof fetch;

			const res2 = await app.request('http://localhost/');
			assertEquals(res2.status, 200);
			const json = await res2.json() as { targets: Array<{ changed: boolean | null; url: string }> };
			for (const t of json.targets) {
				assertEquals(t.changed, true, 'mudança de conteúdo deve ser detectada');
			}

			// notify deve ser chamado exatamente uma vez por URL que mudou.
			assertEquals(calls.length, CONFIG.TARGET_URLS.length, 'notify deve ser chamado uma vez por URL alterada');
			for (let i = 0; i < calls.length; i++) {
				assertStringIncludes(calls[i], CONFIG.TARGET_URLS[i], `mensagem ${i} deve mencionar a URL correspondente`);
				assertStringIncludes(calls[i], 'mudou', `mensagem ${i} deve indicar mudança`);
			}
		} finally {
			restore();
			await clearWatchedUrls();
		}
	},
});

Deno.test({
	name: 'GET /: falhas individuais de fetch não derrubam o endpoint (retorna 200 com status error) — notify não chamado',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		await clearWatchedUrls();
		const original = globalThis.fetch;
		const { notify, calls } = captureNotify();
		// Força fetch a lançar — checkOne captura como status 'error', mas a camada externa
		// ainda retorna 200 com targets. Documenta que falhas individuais de URL não propagam.
		globalThis.fetch = (() => Promise.reject(new Error('network down'))) as typeof fetch;
		try {
			const app = createApp({ notify });
			const res = await app.request('http://localhost/');
			assertEquals(res.status, 200, 'falhas individuais não devem derrubar o endpoint');
			const json = await res.json() as { ok: boolean; targets: Array<{ changed: null; updatedAt: null }> };
			assertEquals(json.ok, true);
			for (const t of json.targets) {
				assertEquals(t.changed, null);
				assertEquals(t.updatedAt, null, 'URLs com erro não devem ter updatedAt');
			}

			// Erros de fetch não disparam notificação (só mudança de conteúdo dispara).
			assertEquals(calls.length, 0, 'notify não deve ser chamado quando fetch falha');
		} finally {
			globalThis.fetch = original;
			await clearWatchedUrls();
		}
	},
});

Deno.test({
	name: 'CORS: header Access-Control-Allow-Origin presente na resposta',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		const app = createApp({ notify: noopNotify });
		const res = await app.request('http://localhost/x', {
			headers: { origin: 'https://example.com' },
		});
		const allowOrigin = res.headers.get('access-control-allow-origin');
		assert(allowOrigin !== null, 'middleware CORS deve adicionar Access-Control-Allow-Origin');
	},
});
