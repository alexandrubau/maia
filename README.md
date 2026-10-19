# maia

A [Flue](https://flueframework.com) agent project.

## Setup

```sh
npm install
cp .env.dist .env
```

Then fill in the empty values in `.env`. `.env.dist` documents every variable the app reads and is the default `.env` of the Docker image.

Create the app's tables:

```sh
npx kysely migrate:latest
```

## Talk to your agent

```sh
npx flue run src/agents/hello.ts --message "Say hello!"
```

Conversations are durable — pass `--id <id>` to continue one.

## Develop

```sh
npm run dev
```

The Hello agent is served at `http://localhost:5173/agents/hello` — see `src/app.ts` for the route map and an example request.

### Migrations

The app's tables come from the migrations in `src/migrations`. The server doesn't apply them: run `npx kysely migrate:latest` after cloning and whenever you pull new ones. The Docker image applies them each time it starts.

```sh
npx kysely migrate:make add_user_prefs   # new migration in src/migrations
npx kysely migrate:list                  # applied and pending migrations
npx kysely migrate:latest                # apply the pending ones
npx kysely migrate:down                  # undo the last one
```

## Deploy

```sh
npm run build
npx kysely migrate:latest
node dist/server.mjs
```

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `npx flue docs` from the terminal.
