
/**
 * Internal logger utility to print tagged lines with optional structured data.
 * @param tag Either 'SUCCESS' or 'ERROR'.
 * @param message Main text to log.
 * @param extra Optional structured object appended to the line.
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
 * Logging facade with success/error tags.
 */
export const log = {
	/** Logs a success/info message. */
	info: (message: string, extra?: Record<string, unknown>) => base('SUCCESS', message, extra),
	/** Logs an error message. */
	error: (message: string, extra?: Record<string, unknown>) => base('ERROR', message, extra),
};
