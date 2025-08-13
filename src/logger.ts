/**
 * Utilitário interno de logging para imprimir linhas com tag e dados estruturados opcionais.
 * @param tag 'SUCCESS' ou 'ERROR'.
 * @param message Mensagem principal a ser registrada.
 * @param extra Objeto opcional com dados estruturados anexados ao log.
 */
function base(tag: 'SUCCESS' | 'ERROR', message: string, extra?: Record<string, unknown>) {
	const line = `[CHECK ${tag}] ${new Date().toISOString()} - ${message}`;
	if (tag === 'ERROR') {
		extra ? console.error(line, extra) : console.error(line);
	} else {
		extra ? console.log(line, extra) : console.log(line);
	}
}

/**
 * Fachada de logging com tags de sucesso/erro.
 */
export const log = {
	/** Registra uma mensagem de sucesso/informativa. */
	info: (message: string, extra?: Record<string, unknown>) => base('SUCCESS', message, extra),
	/** Registra uma mensagem de erro. */
	error: (message: string, extra?: Record<string, unknown>) => base('ERROR', message, extra),
};
