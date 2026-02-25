# Astro Playground

A web UI for testing and interacting with AI agents powered by [astro-messaging](https://github.com/astropods/messaging).

## Features

- Stream responses from AI agents via SSE
- Multi-model selector (OpenAI, Anthropic, Google)
- Tool call step indicators with live status
- Reasoning token display
- Agent config viewer with graph visualization
- Markdown + syntax-highlighted code rendering

## Development

```bash
bun install
bun run dev
```

Requires `astro-messaging` running locally with the web adapter enabled:

```bash
WEB_ENABLED=true astro-messaging
```

## Docker

```bash
docker pull astropods/playground
docker run -p 80:80 \
  -e BACKEND_URL=http://astro-messaging:8080 \
  astropods/playground
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `BACKEND_URL` | `http://astro-messaging:8080` | Where nginx proxies `/api` and `/health` requests |
| `API_URL` | *(empty)* | Frontend API URL override — leave empty to use the nginx proxy |

## Docker Compose

```yaml
services:
  playground:
    image: astropods/playground
    ports:
      - "80:80"
    environment:
      BACKEND_URL: http://astro-messaging:8080
```
