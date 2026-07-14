import { assert, assertEquals } from '@std/assert';
import { getCachedHash, keysFor, kv, setCache } from '@/kv.ts';

const TEST_URL = 'https://test.kv.example/__unit__';

async function cleanup() {
	const k = keysFor(TEST_URL);
	await kv.atomic().delete(k.content).delete(k.hash).delete(k.updatedAt).commit();
}

Deno.test({
	name: 'kv: instância Deno.Kv exportada e utilizável',
	sanitizeOps: false,
	sanitizeResources: false,
	fn() {
		assert(kv && typeof kv.get === 'function', 'kv deve expor método get');
		assert(typeof kv.atomic === 'function', 'kv deve expor método atomic');
	},
});

Deno.test({
	name: 'keysFor: retorna os três namespaces corretos sob watcher/<url>',
	sanitizeOps: false,
	sanitizeResources: false,
	fn() {
		const url = 'https://example.com/page';
		const k = keysFor(url);
		assertEquals(k.content, ['watcher', url, 'content']);
		assertEquals(k.hash, ['watcher', url, 'hash']);
		assertEquals(k.updatedAt, ['watcher', url, 'updatedAt']);
	},
});

Deno.test({
	name: 'keysFor: cada URL tem seu próprio namespace isolado',
	sanitizeOps: false,
	sanitizeResources: false,
	fn() {
		const a = keysFor('https://a.com');
		const b = keysFor('https://b.com');
		assert(a.hash !== b.hash, 'chaves de URLs distintas devem ser arrays diferentes');
		assertEquals(a.hash[1], 'https://a.com');
		assertEquals(b.hash[1], 'https://b.com');
	},
});

Deno.test({
	name: 'setCache + getCachedHash: armazena e recupera hash da mesma URL',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		await cleanup();
		try {
			await setCache(TEST_URL, '<html>x</html>', 'hash-abc-123');
			const recovered = await getCachedHash(TEST_URL);
			assertEquals(recovered, 'hash-abc-123');
		} finally {
			await cleanup();
		}
	},
});

Deno.test({
	name: 'getCachedHash: retorna null quando não há cache prévio',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		await cleanup();
		try {
			const result = await getCachedHash(TEST_URL);
			assertEquals(result, null);
		} finally {
			await cleanup();
		}
	},
});

Deno.test({
	name: 'setCache: grava updatedAt como ISO string legível e atual',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		await cleanup();
		try {
			const before = new Date().toISOString();
			await setCache(TEST_URL, 'content', 'h');
			const after = new Date().toISOString();

			const updatedAtEntry = await kv.get<string>(keysFor(TEST_URL).updatedAt);
			const updatedAt = updatedAtEntry.value;
			if (updatedAt == null) {
				assert(false, 'updatedAt deve estar presente no KV');
				return;
			}
			assertEquals(typeof updatedAt, 'string');
			assert(updatedAt >= before, `updatedAt (${updatedAt}) deve ser >= ${before}`);
			assert(updatedAt <= after, `updatedAt (${updatedAt}) deve ser <= ${after}`);

			// Deve ser parseable como ISO.
			const parsed = new Date(updatedAt).toISOString();
			assertEquals(parsed, updatedAt, 'updatedAt deve ser uma data ISO válida');
		} finally {
			await cleanup();
		}
	},
});

Deno.test({
	name: 'setCache: grava content no KV para auditoria',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		await cleanup();
		try {
			await setCache(TEST_URL, '<body>hello</body>', 'h');
			const entry = await kv.get<string>(keysFor(TEST_URL).content);
			assertEquals(entry.value, '<body>hello</body>');
		} finally {
			await cleanup();
		}
	},
});

Deno.test({
	name: 'setCache: segunda chamada sobrescreve content e hash atomicamente',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		await cleanup();
		try {
			await setCache(TEST_URL, 'content-v1', 'hash-v1');
			await setCache(TEST_URL, 'content-v2', 'hash-v2');

			const content = (await kv.get<string>(keysFor(TEST_URL).content)).value;
			const hash = await getCachedHash(TEST_URL);
			assertEquals(content, 'content-v2', 'segundo setCache deve sobrescrever content');
			assertEquals(hash, 'hash-v2', 'segundo setCache deve sobrescrever hash');
		} finally {
			await cleanup();
		}
	},
});
