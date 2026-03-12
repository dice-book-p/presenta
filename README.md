# Presenta (프레젠타)

행사 슬라이드쇼 + 실시간 전자서명 시스템.

## Tech Stack

- **Frontend**: SvelteKit + Svelte 5 (runes)
- **Backend**: Node.js (raw HTTP + ws)
- **Storage**: Supabase Storage (or local filesystem)

## Development

```sh
npm install
npm run dev
```

## Production

```sh
npm run build
node server/index.js
```
