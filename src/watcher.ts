import { CONFIG } from './config.ts';
import { log } from './logger.ts';
import { getCachedHash, setCache } from './kv.ts';
import { notifyAdmin } from './notifier.ts';

/**
 * Computes the SHA-256 hash of a string and returns it as a hex string.
 * @param input The string to hash.
 */
async function sha256Hex(input: string): Promise<string> {
	const enc = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', enc);
	const bytes = new Uint8Array(digest);
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Fetches a page and returns its HTML content.
 * @param url The URL to fetch.
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
 * Extracts the inner HTML of the <body> element if present.
 * If not found, returns null.
 * @param html Full HTML document as text.
 */
function extractBody(html: string): string | null {
	const m = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
	if (!m) return null;
	return m[1] ?? '';
}

/**
 * Retrieves the content to be used for hashing/comparison: prefers the body inner HTML,
 * falling back to the full HTML when a body is not present.
 * @param url The page URL.
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
 * Removes known dynamic fields that change per request, such as hidden CSRF tokens,
 * to avoid spurious hash changes.
 * Currently removes hidden CSRF-like inputs (e.g., _token/csrf), HTML comments,
 * <script>/<style> blocks, and normalizes whitespace.
 * @param content HTML fragment to sanitize (typically the body inner HTML).
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

/**
 * Checks the target site, compares with KV cache, updates cache, and notifies the admin if changed.
 * Emits logs for success, error, cache equal and cache different cases.
 */
export async function checkSiteAndMaybeNotify(): Promise<void> {
	for (const url of CONFIG.TARGET_URLS) {
		try {
			const content = await getComparableContent(url);
			const hash = await sha256Hex(content);
			const cachedHash = await getCachedHash(url);

			if (!cachedHash) {
				await setCache(url, content, hash);
				log.info('[CACHE INIT] No previous cache found; initialized.', { url });
				continue;
			}

			if (cachedHash !== hash) {
				log.info('[CACHE DIFFERENT] Site content changed.', { url, cachedHash, newHash: hash });
				await setCache(url, content, hash);
				await notifyAdmin(`Url Watcher: o conteúdo de ${url} mudou.`);
			} else {
				log.info('[CACHE EQUAL] Site content unchanged.', { url, hash });
			}
		} catch (err) {
			log.error('Check failed', { url, err: (err as Error).message });
		}
	}
}
