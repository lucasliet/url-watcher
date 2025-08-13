/**
 * Configuração global derivada de variáveis de ambiente e valores padrão.
 */
export const CONFIG = {
	TOKEN: Deno.env.get('TELEGRAM_CHAT_BOT_TOKEN') ?? undefined,
	PORT: Number(Deno.env.get('PORT') ?? '3333') || 3333,
	ADMIN_USER_ID: (() => {
		const raw = Deno.env.get('TELEGRAM_USER_ID');
		if (!raw) return undefined;
		const n = Number(raw);
		return Number.isFinite(n) ? n : undefined;
	})(),
	IS_DEPLOY: Boolean(Deno.env.get('DENO_DEPLOYMENT_ID')),
	/**
	 * Lista de URLs (separadas por vírgula) a serem monitoradas.
	 * Mantém compatibilidade retroativa com a URL única anterior quando não fornecida.
	 */
	TARGET_URLS: (() => {
		const fromEnv = Deno.env.get('WATCH_URLS')?.split(',').map((s) => s.trim()).filter(Boolean);
		if (fromEnv && fromEnv.length > 0) return Array.from(new Set(fromEnv));
		return ['https://capybarabr.com/application'];
	})(),
} as const;
