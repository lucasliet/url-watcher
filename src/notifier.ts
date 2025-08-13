import { Bot } from 'grammy';
import { CONFIG } from './config.ts';
import { log } from './logger.ts';

let BOT: Bot | null = null;
if (CONFIG.TOKEN) {
	BOT = new Bot(CONFIG.TOKEN);
}

/**
 * Sends a Telegram DM to the configured admin user.
 * If the token or admin ID are missing, logs an error and returns.
 * @param message The message to send.
 */
export async function notifyAdmin(message: string) {
	if (!CONFIG.TOKEN || !BOT) {
		log.error('TELEGRAM_CHAT_BOT_TOKEN not configured; skipping notification');
		return;
	}
	if (CONFIG.ADMIN_USER_ID == null) {
		log.error('TELEGRAM_USER_ID not configured; skipping notification');
		return;
	}
	try {
		await BOT.api.sendMessage(CONFIG.ADMIN_USER_ID, message);
		log.info('Notification sent to admin');
	} catch (err) {
		log.error('Failed to send Telegram notification', { err: (err as Error).message });
	}
}
