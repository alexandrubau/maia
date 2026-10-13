# maia

A [Flue](https://flueframework.com) agent project.

## Setup

```sh
npm install
cp .env.dist .env
```

Then fill in the empty values in `.env`. `.env.dist` documents every variable the app reads and is the default `.env` of the Docker image.

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

## Deploy

```sh
npm run build
node dist/server.mjs
```

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `npx flue docs` from the terminal.
