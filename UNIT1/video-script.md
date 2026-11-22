# Video 1 — Script: code & AI

## Part 1 — Transition
The AI solves the one thing understanding how people actually talk/write. It turns a messy sentence into one precise, validated action. Everything else — what exists, what's available, what plays — is plain code.

---

## Part 2 — Project structure 
```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── api/command/route.ts
└── lib/
    ├── catalog.ts
    ├── api-types.ts
    ├── prompt.ts
    ├── contract.ts
    ├── playback.ts
    ├── reply.ts
    └── youtube-mock.ts
```

This is a Next.js project with TypeScript, and it's split in two folders.

`app` is what Next.js turns into routes. There are only three files here that matter:

- `layout.tsx` is just the HTML shell — fonts, title, nothing interesting.
- `page.tsx` is the simulator you just saw: the radio on the left, the inspector on the right. It's a regular React client component. It sends what you typed to the server and reads the response as a stream.
- And `api/command/route.ts` is the server endpoint. Every time you "talk" to the radio, one request hits this file. This is the backbone of the whole turn, and we'll keep coming back to it.

Then `lib` is shared logic. I'll group these by role, because that's what matters:

- **The AI part** — three files.
 `prompt.ts` builds everything the model gets to see.
  `contract.ts` defines what the model is allowed to answer, and what the app is willing to execute. 
  `catalog.ts` is the list of channels — the single source of truth both of those rely on.

- **The product rules, in plain code** —
 `playback.ts` decides what actually plays, and `reply.ts` decides what the radio says and whether a request is still pending.

- **Simulation** — `youtube-mock.ts` fakes the YouTube lookups, so I can force "live", "not live", or "error" on demand. It's clearly labeled as simulated in the UI, and it's the only fake piece: the model calls are real.
- **Glue** — `api-types.ts` holds the TypeScript types shared by the page and the server, so if one side changes, the compiler catches it on the other.

Today we're focusing on the AI part and on the line between the AI and the code.

---

## Part 3 — The map of one turn

Before we go file by file, let's follow one single turn from start to finish. Everything else in this video is a zoom-in on one of these steps.

```
 Browser (page.tsx)
   │  1. Listener types "Play OLGA"
   │     body = utterance + history + pending + simulated scenarios
   ▼
 Server (route.ts)
   │  0. RequestSchema validates the body           → bad input? 400, stop here
   │  1. Context      prompt.ts builds system + messages      → panel 1
   │  2. Model call   Claude writes JSON, streamed as deltas  → panel 2
   │  3. Validation   validateModelText() on the COMPLETE object → panel 3
   │  4. Execution    only if valid:
   │                   - select_channel → playback.ts asks YouTube (simulated) → panel 4
   │                   - reply.ts writes what the radio says
   │                   - reply.ts decides the pending state for next turn → panel 5
   ▼
 Browser (page.tsx)
      "final" event → the radio speaks, the player starts, pending is saved
```

Here's the turn in words.

I type "Play OLGA". The page packs that into a request together with the recent history and any pending question, and sends it to `/api/command`.

On the server, `route.ts` runs four steps — and they're literally labeled 1 to 4 in the code:

1. **Context.** `prompt.ts` builds everything the model will see: the rules, the catalog, the history, and the current request.
2. **Model call.** Claude answers with a JSON object. As it writes, the fragments are streamed back to the page — just for display.
3. **Validation.** Only when the object is complete, `validateModelText()` checks it: valid JSON, the right fields for that action, and a channel ID that exists in the catalog.
4. **Execution.** Only now does anything happen. If it's `select_channel`, the code checks YouTube to see what can actually play. Then `reply.ts` writes the sentence the radio says, and decides whether a question is still pending.

Everything comes back to the browser as a stream of events, one JSON per line. The last one, `final`, is what makes the radio speak and the player start.

Notice where the model sits: only in step 2. Everything before it prepares its input, everything after it checks its output and deals with the real world. The model decides *what the listener meant* — the code decides *what actually happens*.

And the inspector on the right follows the same order: panels 1 to 5 are these steps, from top to bottom.

**Show:**
1. Send "Play OLGA" and point at each panel as it fills: 1 (context) → 2 (fragments) → 3 (validated object) → 4 (YouTube lookup) → 5 (pending state).
2. Open `route.ts` and scroll through the four `// ---------- N. ----------` section markers.

**Files:**
- `src/app/page.tsx` → `sendCommand()` (builds the body, reads the stream) and `handleEvent()`
- `src/app/api/command/route.ts` → `RequestSchema`, then sections 1. Context, 2. Model call (streaming), 3. Validation, 4. Execution + external data
- `src/lib/prompt.ts`, `src/lib/contract.ts`, `src/lib/playback.ts`, `src/lib/reply.ts` → one per step, covered in the next parts

---

## Part 4 — Model context

The model has no memory between calls. Everything it "knows" about this radio, it learns from what we send on every single request. So the first job is deciding exactly what goes in.

That happens in `prompt.ts`, in two functions:

- `buildSystemPrompt()` builds the **system prompt**: the product rules — what actions exist and how to behave — plus the channel catalog as JSON, inside a `<catalog>` tag. This part is the same on every call.
- `buildMessages()` builds the **messages**: the last six turns of the conversation, each one as a user/assistant pair, and then the current request at the end.

The catalog itself lives in `catalog.ts`. Each channel has three things: a `channelId`, which is the real YouTube ID, a `name`, and a list of `aliases` — the ways people actually say it out loud.

Let me show you what the model really sees.

**Show:**
1. Type "Play the usual one".
2. Open panel 1, *Model call log*, and expand *system (rules + catalog)*.
3. Point out: six channels, their names and aliases — and nothing about the listener's preferences.
4. Point out rule 3: "the usual one" does not identify a channel.

So when I say "the usual one", the model has no way of knowing what that is. It's not a bug in the model — that information simply isn't in its context. And instead of guessing, it asks.

**Files:**
- `src/lib/prompt.ts` → `PRODUCT_RULES`, `buildSystemPrompt()`, `buildMessages()`, `MAX_HISTORY_TURNS`
- `src/lib/catalog.ts` → `CATALOG`
- `src/app/api/command/route.ts` → step "1. Context", where both functions are called and the log is sent to panel 1

---

## Part 5 — Conversational state

When the radio asks a question, the original request isn't finished yet. It's waiting for the listener's answer. We call that a **pending** request, and keeping track of it is the conversational state.

The important part: the server doesn't remember anything. The state makes a round trip on every turn.

- After each turn, `nextPendingState()` in `reply.ts` decides what the state is. If the model asked a question, it saves the original request and the question. Any other action clears it.
- The page stores it and sends it back in the next request.
- And `buildMessages()` adds it to the prompt as an explicit `<pending_request>` block. We don't rely on the model figuring it out from the history — we tell it.

**Show:**
1. Type "Play the usual one". The radio asks which channel. The *"Waiting for an answer to…"* badge appears, and panel 5 shows the pending request.
2. Type "OLGA". In panel 1, the last message now includes the `<pending_request>` block with the original request.
3. Result: `select_channel` with OLGA, and panel 5 goes back to `pending: null`.

"OLGA" on its own isn't a full request — it's an answer. The second turn completes the first one.

One more detail: if something fails in the middle, the pending request is kept, so the listener doesn't lose the open question.

**Files:**
- `src/lib/reply.ts` → `nextPendingState()`
- `src/lib/prompt.ts` → `buildMessages()`, the `<pending_request>` block
- `src/app/page.tsx` → the `pending` state and `updatePending()`; it goes back to the server inside the request body
- `src/app/api/command/route.ts` → `nextPending = body.pending`, which keeps the state if validation fails

---

## Part 6 — Structured outputs

The model doesn't answer with free text. It answers with JSON in a fixed shape, and that JSON is validated before the app does anything with it.

The contract lives in `contract.ts`, and it has two schemas, on purpose:

- **`ModelOutputSchema`** is what we ask the model for. It's sent to Claude as a JSON Schema through `betaZodOutputFormat`, so the API constrains the answer to that shape. And `channelId` is an enum built from the catalog IDs — the model literally cannot invent a channel.
- **`CommandSchema`** is what the app is willing to execute. It's a discriminated union on `action`: each action requires its own fields. For example, `select_channel` without a `channelId` doesn't pass, because the app wouldn't know what to play.

The first schema limits what the model can write. The second one decides whether that's enough to act on.

Then `validateModelText()` runs the whole check on the complete answer, in three steps: is it valid JSON? Does it match `CommandSchema`? Does the channel ID exist in the catalog? Only if all three pass does anything get executed.

And we validate in the other direction too: `RequestSchema` in `route.ts` checks what the browser sends before we even call the model. The server doesn't trust the client either.

**Show:**
1. Same two turns as before. In panel 3, turn 1: `{ action: "needs_more_info", channelId: null, question: "…", reason: "…" }` → ✓ valid.
2. Turn 2: `{ action: "select_channel", channelId: "UC7mJ2EDXFomeDIRFu5FtEbA", … }`. Open `catalog.ts` and show that this ID is OLGA.
3. In panel 1, expand *output schema*: that's the JSON Schema Claude receives.

**Files:**
- `src/lib/contract.ts` → `ModelOutputSchema`, `CommandSchema`, `validateModelText()`
- `src/lib/catalog.ts` → `CHANNEL_IDS`
- `src/app/api/command/route.ts` → `RequestSchema` (input), `betaZodOutputFormat(ModelOutputSchema)` (output format), step "3. Validation"

---

## Part 7 — Designing for uncertainty

When a piece of information is missing, the model shouldn't guess, and it shouldn't just fail either. It should figure out *what* is missing and turn that into a concrete question.

That's designed into the product rules as three possible actions:

- `select_channel` — the request clearly identifies one channel.
- `needs_more_info` — the listener wants a channel, but we don't know which one. The model returns a question.
- `unsupported_command` — the request is out of scope: volume, weather, small talk.

Rule 6 says the question must name what's missing, be short, and be easy to say out loud — because it's a radio, someone is going to *hear* it. And in `reply.ts`, when the action is `needs_more_info`, the radio says exactly that question.

**Show** — compare these in panel 3, and read the `reason` field out loud:

| Request | Action | Why |
|---|---|---|
| "Play OLGA" | `select_channel` | The channel is named and it's in the catalog |
| "Play the usual one" | `needs_more_info` | The missing piece is *which channel* |
| "Turn up the volume" | `unsupported_command` | It's not a channel request |

**Files:**
- `src/lib/prompt.ts` → `PRODUCT_RULES`: the three actions, rule 3 ("the usual one") and rule 6 (the question)
- `src/lib/contract.ts` → the `action` enum in `ModelOutputSchema`
- `src/lib/reply.ts` → `buildReply()`, case `needs_more_info`

---

## Part 8 — External data

There are two different questions behind every request:

1. **What did the listener want?** That's interpretation — understanding language. The model answers it.
2. **Can it actually be played right now?** That depends on what's happening on YouTube at this moment.

That second one is external data: it doesn't live in my code and it isn't in the model either. It lives in YouTube, and it changes all the time. The model can't know whether OLGA is live right now — and if I asked it, it might make something up. That's why rule 7 tells it: you only interpret the request; the system checks availability afterwards.

So the code goes and looks. Only after a validated `select_channel`, `resolvePlayback()` in `playback.ts` asks YouTube: is the channel live? If it's confirmed not live, it looks for the latest upload. And if the lookup fails, it plays nothing — because if we don't know whether there's a live stream, falling back to an old video could hide it. That's a product rule, so it lives in code, not in the prompt.

In this project the YouTube calls are simulated in `youtube-mock.ts`, so I can force each case.

**Show:**
1. Click *Try "Play OLGA" with all 3 results*.
2. For each result, compare: panel 3 stays **identical** — the model understood the same thing. Panel 4 and the player change.

| Scenario | Player | The radio says |
|---|---|---|
| `live_found` | LIVE | "Playing OLGA live." |
| `no_live_found` | LATEST VIDEO | "OLGA isn't live right now. Playing their latest video…" |
| `lookup_failed` | nothing plays | "I couldn't check whether OLGA is live…" |

The model interprets the request. The code checks YouTube. And the player is what confirms playback — not the model's words.

**Files:**
- `src/lib/prompt.ts` → rule 7
- `src/lib/playback.ts` → `resolvePlayback()`
- `src/lib/youtube-mock.ts` → `lookupLive()`, `lookupLatestUpload()`
- `src/lib/reply.ts` → `buildReply()`, case `select_channel`
- `src/app/api/command/route.ts` → step "4. Execution + external data"

---

## Part 9 — Streaming

While the model is writing, we stream its output to the page, so the listener can see something is happening instead of staring at a frozen screen.

But there's a rule: fragments are for **display only**. Nothing is executed from a fragment.

With free text, that's fine — the text *is* the result, so showing it as it arrives is all you need. But here the result is an *action*, and half a JSON object can't be validated. You can't play "half a channel ID". So we wait for the complete object, validate it, and only then act.

In the code: the server forwards every text fragment as a `delta` event. Only after the final message arrives does it validate — and if the response didn't finish properly, for example it got cut off, it's marked as incomplete and nothing runs. On the page, `delta` events only get appended to panel 2.

**Show:**
1. Send any command and watch panel 2: pieces like `{"act` and `ion":"sel` appear one by one.
2. Point out that the player doesn't move yet.
3. When the `final` event arrives, panel 3 shows *✓ valid → executed*, and only then the player starts.

**Files:**
- `src/app/api/command/route.ts` → the `for await` loop that sends `delta`, then `finalMessage()` and the `stop_reason` check
- `src/app/page.tsx` → `handleEvent()`: `delta` only updates panel 2; `final` is the only event that moves the player

---

## Part 10 — Wrap-up

- **Context**: the model only knows what we send it — rules, catalog, recent history, and any pending request, made explicit.
- **State**: a half-finished request is tracked by the code and handed back to the model on the next turn.
- **Structured outputs**: one schema limits what the model writes, a second one decides what the app executes.
- **Uncertainty**: when information is missing, ask a specific question about that missing piece.
- **External data**: the model interprets the request; code checks reality.
- **Streaming**: show fragments, but only act on the complete, validated object.

The model is one small, well-fenced piece in the middle. Everything around it is plain code you can test, read, and trust.
