# Radio Vivos: Unit 1

A voice-command radio that plays live streams from YouTube channels. You type a sentence like "play the news channel", and Claude turns it into one validated action. Everything else (what exists, what's available, what plays) is plain code.

This is the code from the video. Read it, run it, change it.

## Run it yourself

You need [Node.js](https://nodejs.org) and your own Anthropic API key from [console.anthropic.com](https://console.anthropic.com).

```bash
cd UNIT1
npm install
cp .env.example .env.local   # then paste your key into .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Each command you send makes one call to the Claude API and uses your credits. `.env.local` is in `.gitignore`, so your key is never committed.

## Where to look

| File | What it does |
| --- | --- |
| `src/app/page.tsx` | The page: input box, chat, and an inspector that shows exactly what was sent to the model |
| `src/app/api/command/route.ts` | `POST /api/command`: validates the request, calls Claude, validates the answer, decides what plays |
| `src/lib/prompt.ts` | Builds the context the model receives (rules + catalog + recent turns) |
| `src/lib/contract.ts` | The Zod schemas: what the model may answer and what the app is willing to execute |
| `src/lib/catalog.ts` | The channels the radio knows |
| `src/lib/playback.ts` | Live stream first, latest upload as a fallback. A product rule, so it lives in code |
| `src/lib/reply.ts` | What the radio says back. Built by code, not by the model |
| `src/lib/youtube-mock.ts` | Simulated YouTube lookups, so you can test every scenario |

`ai-1.pdf` is the diagram of the full flow, and `video-script.md` is the script of the video.

## About the API key and security

- The key is only read on the server (`route.ts`). It never reaches the browser, and it is never put in the prompt, so the model can't reveal it.
- The model can only answer with one of three actions and only with channel IDs from the catalog. The app validates that before doing anything.
- User text is length-limited and stripped of `<` `>` so it can't break out of the prompt's tags.

This project is meant to run locally. If you deploy it publicly with your key, anyone can call `/api/command` and spend your credits, so add rate limiting or login first.
