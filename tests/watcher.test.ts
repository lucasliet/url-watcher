import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { extractBody, sanitizeDynamicContent, sha256Hex } from '@/watcher.ts';

// Hash SHA-256 esperado para a string "hello world" (hex), pré-computado offline.
// Referência: `echo -n "hello world" | shasum -a 256` em macOS.
const SHA256_HELLO_WORLD = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';

Deno.test('sha256Hex: retorna hash hex correto para entrada conhecida', async () => {
	const result = await sha256Hex('hello world');
	assertEquals(result, SHA256_HELLO_WORLD);
	assertEquals(result.length, 64, 'hash SHA-256 em hex deve ter 64 caracteres');
});

Deno.test('sha256Hex: string vazia produz hash canônico', async () => {
	const result = await sha256Hex('');
	assertEquals(result, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

Deno.test('sha256Hex: entradas diferentes produzem hashes diferentes', async () => {
	const a = await sha256Hex('a');
	const b = await sha256Hex('b');
	assert(a !== b, 'hashes de entradas distintas devem ser distintos');
});

Deno.test('extractBody: retorna conteúdo interno quando <body> existe', () => {
	const html = '<html><head><title>x</title></head><body><p>conteúdo</p></body></html>';
	assertEquals(extractBody(html), '<p>conteúdo</p>');
});

Deno.test('extractBody: retorna null quando não há <body>', () => {
	const html = '<html><head></head><p>sem body</p></html>';
	assertEquals(extractBody(html), null);
});

Deno.test('extractBody: lida com atributos no <body>', () => {
	const html = '<body class="page" data-theme="dark"><h1>Título</h1></body>';
	assertEquals(extractBody(html), '<h1>Título</h1>');
});

Deno.test('extractBody: case-insensitive (BODY maiúsculo)', () => {
	const html = '<BODY><span>1</span></BODY>';
	assertEquals(extractBody(html), '<span>1</span>');
});

Deno.test('extractBody: retorna string vazia para body vazio', () => {
	assertEquals(extractBody('<body></body>'), '');
});

Deno.test('sanitizeDynamicContent: remove inputs hidden CSRF-like', () => {
	const html = `<form><input type="hidden" name="_token" value="abc123"><button>ok</button></form>`;
	const out = sanitizeDynamicContent(html);
	assertStringIncludes(out, '<button>ok</button>', 'botão deve permanecer');
	assert(!out.includes('_token'), 'campo CSRF _token deve ser removido');
	assert(!out.includes('abc123'), 'valor do token deve ser removido');
});

Deno.test('sanitizeDynamicContent: remove comentários HTML', () => {
	const html = `<div>a</div><!-- comentário secreto --><div>b</div>`;
	const out = sanitizeDynamicContent(html);
	assert(!out.includes('comentário secreto'), 'comentário deve ser removido');
	assertStringIncludes(out, '<div>a</div>');
	assertStringIncludes(out, '<div>b</div>');
});

Deno.test('sanitizeDynamicContent: remove blocos <script> e <style>', () => {
	const html = `<div>x</div><script>var t = "leak";</script><style>.a { color: red; }</style><div>y</div>`;
	const out = sanitizeDynamicContent(html);
	assert(!out.includes('<script'), 'script tag deve ser removida');
	assert(!out.includes('<style'), 'style tag deve ser removida');
	assert(!out.includes('leak'), 'conteúdo do script não deve vazar');
	assert(!out.includes('color: red'), 'conteúdo do style não deve vazar');
});

Deno.test('sanitizeDynamicContent: normaliza whitespace consecutivo', () => {
	const html = `<div>\n\n  texto\n\tcom\t   espaços   </div>`;
	const out = sanitizeDynamicContent(html);
	assert(!out.includes('\n'), 'quebras de linha devem ser normalizadas');
	assert(!out.includes('\t'), 'tabs devem ser normalizadas');
	assert(!out.includes('  '), 'espaços duplos devem ser normalizados para espaço simples');
});

Deno.test('sanitizeDynamicContent: idempotência (sanitizar de novo não muda resultado)', () => {
	const html = `<div>a</div><!-- c --><script>x</script>`;
	const once = sanitizeDynamicContent(html);
	const twice = sanitizeDynamicContent(once);
	assertEquals(once, twice, 'segunda passada deve produzir o mesmo resultado');
});

Deno.test('sanitizeDynamicContent: CSRF variants (csrf, csrf_token, authenticity_token)', () => {
	const cases = ['csrf', 'csrf_token', 'authenticity_token'];
	for (const name of cases) {
		const html = `<input type="hidden" name="${name}" value="v">`;
		const out = sanitizeDynamicContent(html);
		assertEquals(out.trim(), '', `input hidden name="${name}" deve ser removido inteiramente`);
	}
});

Deno.test('sanitizeDynamicContent: preserva inputs não-CSRF', () => {
	const html = `<input type="text" name="username"><input type="hidden" name="preferences" value="dark">`;
	const out = sanitizeDynamicContent(html);
	assertStringIncludes(out, 'name="username"', 'input text deve permanecer');
	assertStringIncludes(out, 'name="preferences"', 'input hidden não-CSRF deve permanecer');
});
