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
async function fetchSiteContent(url: string): Promise<string> {
	log.info(`Starting fetch of ${url}`);
	const res = await fetch(url, { headers: { accept: 'text/html,application/xhtml+xml' } });
	if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);
	const text = await res.text();
	log.info('Fetch completed successfully', { bytes: text.length, url });
	return text;
}

/**
 * Checks the target site, compares with KV cache, updates cache, and notifies the admin if changed.
 * Emits logs for success, error, cache equal and cache different cases.
 */
export async function checkSiteAndMaybeNotify(): Promise<void> {
	for (const url of CONFIG.TARGET_URLS) {
		try {
			const content = await fetchSiteContent(url);
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
