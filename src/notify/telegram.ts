import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

/** Sends short operational alerts. Implementations must never throw. */
export interface Notifier {
  send(text: string): Promise<void>;
}

/** No-op notifier used when Telegram isn't configured. */
export class NullNotifier implements Notifier {
  async send(_text: string): Promise<void> {
    // Intentionally does nothing.
    void _text;
  }
}

/**
 * Sends messages via the Telegram Bot API. Failures are logged, never thrown, so
 * a notification problem can't take down the trading loop.
 */
export class TelegramNotifier implements Notifier {
  constructor(
    private readonly token: string,
    private readonly chatId: string,
    private readonly timeoutMs = 10_000,
  ) {}

  async send(text: string): Promise<void> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        logger.warn({ status: res.status, body }, "Telegram sendMessage failed");
      }
    } catch (err) {
      logger.warn({ err }, "Telegram notification error");
    }
  }
}

/**
 * Build a notifier from config. Returns a no-op notifier (with a one-time log)
 * when the bot token or chat id is missing.
 */
export function createNotifier(): Notifier {
  if (config.telegramBotToken && config.telegramChatId) {
    logger.info("Telegram alerts enabled");
    return new TelegramNotifier(config.telegramBotToken, config.telegramChatId);
  }
  logger.info("Telegram alerts disabled (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)");
  return new NullNotifier();
}
