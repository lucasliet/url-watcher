# AGENTS.md

Repo-specific guidance for LLM agents working in `url-watcher`. Complements the global `~/.config/opencode/AGENTS.md`.

## Stack

- **Deno** app (not Node). No `package.json`, no `node_modules`. Dependencies are pinned URLs in `deno.json` `imports`.
- Uses **Deno KV** and **Deno.cron** — both require unstable flags. The `dev` task already passes `--unstable-kv --unstable-cron`; any new entrypoint that
  touches KV or cron must do the same.
- HTTP server is **Hono** (`jsr:@hono/hono`); Telegram client is **grammy**.

## Commands

Only one task is defined:

```sh
deno task dev   # run with watch + required permissions + unstable flags
```

There is **no `test`, `lint`, or `fmt` task**. Use Deno directly:

```sh
deno fmt            # format
deno lint           # lint
deno fmt --check    # CI-style check
```

No tests exist in the repo. If adding behavior, also add a test (`deno test`).

## Code style (overrides Deno defaults)

Defined in `deno.json` `fmt`:

- **Tabs**, single quotes, semicolons, **`lineWidth: 160`** (very wide — do not rewrap to 80).
- Lint rule `no-explicit-any` is **explicitly disabled**. `any` is acceptable for framework seams (e.g. the Deno Deploy `fetch` event in `main.ts`).
- Existing comments and docstrings are in **Brazilian Portuguese (PT-BR)**. Match that language when editing or adding comments; keep code identifiers in
  English.
- Imports use the `@/` alias (`→ ./src/`) **and** include the explicit `.ts` extension: `import { CONFIG } from '@/config.ts';`. Both are required.

## Architecture & gotchas

### Module-load side effects

- `src/kv.ts` runs `await Deno.openKv()` at top level on import. Importing it opens the KV store.
- `src/notifier.ts` constructs the grammy `Bot` at module load if `TELEGRAM_CHAT_BOT_TOKEN` is set.

Any module that transitively imports these (notably `watcher.ts` → `kv.ts`, `notifier.ts`) inherits those side effects. Do not import them from tests or scripts
casually.

### Deploy vs. local detection

`CONFIG.IS_DEPLOY` is `true` only when `DENO_DEPLOYMENT_ID` is set. This is the signal Deno Deploy injects — do not gate deploy-only behavior on `NODE_ENV` or
anything else.

- **Both paths**: `Deno.serve({ port }, app.fetch)`. The new Deno Deploy requires `Deno.serve()` initialized synchronously to pass the warmup phase; the legacy
  `addEventListener('fetch', ...)` pattern fails it. Deploy ignores the `port` arg; local uses it. See parallel fix in `lucasliet/llm-telegram-bot@5f70409`.
- `IS_DEPLOY` is now only used to suppress the local-only startup log line.

### The daily cron is currently disabled

`main.ts` has the `Deno.cron(...)` block **commented out** (see commit `1fab2d4 chore: disable cron job`). The README still describes daily 08:00 UTC runs. If a
task involves scheduled checks, re-enable it deliberately — do not assume cron is firing.

### `GET /` and `/health` have side effects

These endpoints are **not passive health checks** — each request calls `checkSiteAndMaybeNotify()`, which fetches every configured URL, updates Deno KV, and
**sends Telegram DMs to the admin if any content changed**. Hitting `/` in production can notify a human. Use a different liveness probe if you only want to
check the process.

### Content comparison

`src/watcher.ts` compares pages by SHA-256 of sanitized HTML:

- Prefers inner `<body>` HTML; falls back to full document if no `<body>`.
- `sanitizeDynamicContent` strips hidden CSRF inputs (`_token`, `csrf`, `csrf_token`, `authenticity_token`), HTML comments, and `<script>`/`<style>` blocks,
  then normalizes whitespace.

If a target page starts reporting false changes, extend `sanitizeDynamicContent` rather than tweaking the hashing.

### KV key layout

`src/kv.ts` `keysFor(url)` namespaces everything under `['watcher', url, <field>]` where field is `content | hash | updatedAt`. `setCache` writes all three
atomically; never write one without the others or `/health` will report stale `updatedAt`.

## Environment

Required for the app to do anything useful (set in shell locally, in Deno Deploy project settings):

- `TELEGRAM_CHAT_BOT_TOKEN` — grammy bot token.
- `TELEGRAM_USER_ID` — numeric admin user ID to DM.
- `WATCH_URLS` — comma-separated list of URLs. Defaults to `https://capybarabr.com/application`.
- `PORT` — local only, default `3333`.

Missing token/user IDs are non-fatal: the app runs, checks happen, but notifications are skipped with an error log.

## Deploy

Push to Deno Deploy; set the env vars above in project settings. Deno Deploy attaches the HTTP handler via the `fetch` event listener in `main.ts`. No build
step.
