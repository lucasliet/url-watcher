export const kv = await Deno.openKv();

/**
 * Computes KV keys for a given URL namespace.
 */
export function keysFor(url: string) {
	return {
		content: ['watcher', url, 'content'] as const,
		hash: ['watcher', url, 'hash'] as const,
		updatedAt: ['watcher', url, 'updatedAt'] as const,
	} as const;
}

/**
 * Retrieves the cached content hash from Deno KV.
 * @returns The cached SHA-256 hex string, or null if not present.
 */
export async function getCachedHash(url: string): Promise<string | null> {
	const entry = await kv.get<string>(keysFor(url).hash);
	return (entry.value as string | undefined) ?? null;
}

/**
 * Atomically updates the cached content, its hash, and the last update timestamp.
 * @param content The full HTML content to cache.
 * @param hash The SHA-256 hex string of the content.
 */
export async function setCache(url: string, content: string, hash: string): Promise<void> {
	const now = new Date().toISOString();
	const k = keysFor(url);
	const res = await kv.atomic()
		.set(k.content, content)
		.set(k.hash, hash)
		.set(k.updatedAt, now)
		.commit();
	if (!res.ok) throw new Error('KV atomic set failed');
}
