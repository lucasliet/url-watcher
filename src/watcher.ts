import { CONFIG } from './config.ts';
import { log } from './logger.ts';
import { getCachedHash, keysFor, kv, setCache } from './kv.ts';
import { notifyAdmin } from './notifier.ts';

/**
 * Computa o hash SHA-256 de uma string e o retorna em formato hexadecimal.
 * @param input A string a ser hasheada.
 */
async function sha256Hex(input: string): Promise<string> {
	const enc = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', enc);
	const bytes = new Uint8Array(digest);
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Faz fetch de uma página e retorna seu conteúdo HTML (texto integral).
 * Usa um header Accept para priorizar HTML.
 * @param url A URL a ser buscada.
 * @throws Error quando a resposta não for OK (código HTTP não 2xx) ou em falhas de rede.
 */
async function fetchHtml(url: string): Promise<string> {
	log.info(`Starting fetch of ${url}`);
	const res = await fetch(url, { headers: { accept: 'text/html,application/xhtml+xml' } });
	if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);
	const html = await res.text();
	log.info('Fetch completed successfully', { bytes: html.length, url });
	return html;
}

/**
 * Extrai o HTML interno do elemento <body>, se presente.
 * Caso não encontre, retorna null.
 * @param html Documento HTML completo como texto.
 */
function extractBody(html: string): string | null {
	const m = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
	if (!m) return null;
	return m[1] ?? '';
}

/**
 * Obtém o conteúdo a ser usado para comparação (hashing):
 * - Prefere o HTML interno do <body>; se ausente, usa o HTML completo.
 * - Aplica sanitização para remover campos dinâmicos e normalizar whitespace,
 *   reduzindo falsos positivos.
 * @param url A URL da página.
 * @returns O conteúdo já sanitizado que será usado para cálculo do hash.
 * @throws Error propagada de falhas de rede/fetch.
 */
async function getComparableContent(url: string): Promise<string> {
	const html = await fetchHtml(url);
	const body = extractBody(html);
	const content = body != null ? body : html;
	if (body != null) {
		log.info('Using <body> for comparison', { url, bytes: body.length });
	} else {
		log.info('No <body> found; using full HTML for comparison', { url, bytes: html.length });
	}
	const sanitized = sanitizeDynamicContent(content);
	if (sanitized.length !== content.length) {
		log.info('Sanitized dynamic fields from content before hashing', { url, removedBytes: content.length - sanitized.length });
	}
	return sanitized;
}

/**
 * Remove campos dinâmicos conhecidos que variam por requisição (ex.: tokens CSRF),
 * a fim de evitar mudanças espúrias no hash.
 * Atualmente remove inputs hidden do tipo CSRF (_token/csrf/etc.), comentários HTML,
 * blocos <script>/<style>, e normaliza whitespace.
 * @param content Fragmento HTML a ser sanitizado (geralmente o inner HTML do body).
 */
function sanitizeDynamicContent(content: string): string {
	let out = content;
	// Remove hidden CSRF-like inputs
	out = out.replace(/<input\b[^>]*\btype=(?:"|')hidden(?:"|')[^>]*\bname=(?:"|')(?:_token|csrf|csrf_token|authenticity_token)(?:"|')[^>]*>/gis, '');
	// Remove HTML comments
	out = out.replace(/<!--([\s\S]*?)-->/g, '');
	// Remove script and style tags entirely
	out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gis, '');
	out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gis, '');
	// Normalize whitespace
	out = out.replace(/\s+/g, ' ').trim();
	return out;
}

export type CheckResult = {
	url: string;
	changed: boolean | null; // null quando não havia cache anterior ou em erro
	status: 'initialized' | 'changed' | 'unchanged' | 'error';
	hash?: string;
	previousHash?: string | null;
	updatedAt: string | null;
	error?: string;
};

/**
 * Verifica uma única URL e retorna seu resultado. Responsável por atualizar o KV
 * e enviar notificação quando há mudança detectada.
 */
async function checkOne(url: string): Promise<CheckResult> {
	try {
		const content = await getComparableContent(url);
		const hash = await sha256Hex(content);
		const cachedHash = await getCachedHash(url);

		if (!cachedHash) {
			await setCache(url, content, hash);
			log.info('[CACHE INIT] No previous cache found; initialized.', { url });
			const updatedAt = (await kv.get<string>(keysFor(url).updatedAt)).value ?? null;
			return { url, changed: null, status: 'initialized', hash, previousHash: null, updatedAt };
		}

		if (cachedHash !== hash) {
			log.info('[CACHE DIFFERENT] Site content changed.', { url, cachedHash, newHash: hash });
			await setCache(url, content, hash);
			await notifyAdmin(`Url Watcher: o conteúdo de ${url} mudou.`);
			const updatedAt = (await kv.get<string>(keysFor(url).updatedAt)).value ?? null;
			return { url, changed: true, status: 'changed', hash, previousHash: cachedHash, updatedAt };
		}

		log.info('[CACHE EQUAL] Site content unchanged.', { url, hash });
		const updatedAt = (await kv.get<string>(keysFor(url).updatedAt)).value ?? null;
		return { url, changed: false, status: 'unchanged', hash, previousHash: cachedHash, updatedAt };
	} catch (err) {
		log.error('Check failed', { url, err: (err as Error).message });
		return { url, changed: null, status: 'error', updatedAt: null, error: (err as Error).message };
	}
}

/**
 * Verifica todas as URLs configuradas, compara com o cache no KV, atualiza o cache,
 * e notifica o admin quando algum conteúdo muda.
 * - Executa as verificações em paralelo.
 * - Não lança exceções: agrega os resultados via Promise.allSettled e retorna, para cada URL,
 *   um objeto CheckResult com status 'error' quando houver falha.
 * @returns Array de CheckResult, na mesma ordem de CONFIG.TARGET_URLS.
 */
export async function checkSiteAndMaybeNotify(): Promise<CheckResult[]> {
	const promises = CONFIG.TARGET_URLS.map((url) => checkOne(url));
	const settled = await Promise.allSettled(promises);
	return settled.map((
		r,
		idx,
	) => (r.status === 'fulfilled' ? r.value : {
		url: CONFIG.TARGET_URLS[idx],
		changed: null,
		status: 'error',
		updatedAt: null,
		error: (r.reason instanceof Error ? r.reason.message : String(r.reason)),
	}));
}
