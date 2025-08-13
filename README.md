# Url Watcher (Deno Deploy)

Monitors one or more URLs once per day at 08:00 UTC. Caches the last content in Deno KV and sends a Telegram DM to the configured admin user when any of them changes.

## Environment variables
- TELEGRAM_CHAT_BOT_TOKEN: Bot token from BotFather.
- TELEGRAM_USER_ID: Numeric Telegram user ID of the admin to notify.
- WATCH_URLS: Comma-separated list of URLs to watch (e.g., "https://capybarabr.com/application, https://example.com"). If omitted, defaults to https://capybarabr.com/application.
- PORT: Local dev server port (optional, default 3333).

## Behavior
- On startup: fetches each configured URL, initializes cache if empty, logs success/errors.
- Daily at 08:00 UTC (Deno Deploy via Deno.cron): re-checks; if a hash differs, updates cache and notifies admin with the specific URL.
- Logs:
  - [CHECK SUCCESS] for successful operations.
  - [CHECK ERROR] for failures.
  - [CACHE DIFFERENT] when content changed (per URL).
  - [CACHE EQUAL] when unchanged (per URL).

## Local development

Ensure Deno v1.44+ (for KV and cron). Then run:

```sh
# zsh
export TELEGRAM_CHAT_BOT_TOKEN=123:abc
export TELEGRAM_USER_ID=123456789
export WATCH_URLS="https://capybarabr.com/application,https://example.com"

deno task dev
```

- There is no Telegram webhook or long polling in local dev; notifications are outbound only when differences are detected.
- Oak serves a minimal endpoint on / and /health; GET /health returns a JSON with an array of targets and their last updatedAt.

## Deploy
- Push to Deno Deploy and set the env vars above in the project settings.
- Deno Deploy attaches the HTTP handler via a fetch event listener.
- Cron runs daily at 08:00 UTC.
