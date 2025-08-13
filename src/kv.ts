export const kv = await Deno.openKv();

/**
 * Computa as chaves no KV para um determinado namespace de URL.
 * @param url URL que servirá como namespace das chaves.
 * @returns Objeto imutável com as chaves de content, hash e updatedAt.
 */
export function keysFor(url: string) {
	return {
		content: ['watcher', url, 'content'] as const,
		hash: ['watcher', url, 'hash'] as const,
		updatedAt: ['watcher', url, 'updatedAt'] as const,
	} as const;
}

/**
 * Recupera do Deno KV o hash de conteúdo previamente armazenado para a URL.
 * @param url A URL cuja entrada de hash deve ser lida.
 * @returns A string hex SHA-256 em cache, ou null se ausente.
 */
export async function getCachedHash(url: string): Promise<string | null> {
	const entry = await kv.get<string>(keysFor(url).hash);
	return (entry.value as string | undefined) ?? null;
}

/**
 * Atualiza de forma atômica o conteúdo em cache, seu hash e o timestamp de última atualização.
 * O campo updatedAt é armazenado como string ISO (new Date().toISOString()).
 * @param url A URL cujos dados de cache devem ser atualizados.
 * @param content O HTML completo a ser armazenado em cache.
 * @param hash A string hex SHA-256 do conteúdo.
 * @throws Error se a operação atômica do KV falhar.
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
