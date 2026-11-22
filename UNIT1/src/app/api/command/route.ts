// POST /api/command



/*This library wraps the Claude HTTP API so we don't 
have to build requests by hand (writing the method, the headers, and the body ourselves).*/
import Anthropic from "@anthropic-ai/sdk";

/*Converts the Zod schema into the format Claude understands
Zod (my code)  ──betaZodOutputFormat──►  { type: "json_schema", schema: {...} }  ──►  Claude API*/
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";


/*Zod validates data at runtime. TypeScript types only exist while writing
and compiling the code; they disappear once it runs as JavaScript.
Here we use it to validate the request body and the model's output.*/
import { z } from "zod";

import { findChannel } from "@/lib/catalog";
import { CommandSchema, ModelOutputSchema, validateModelText } from "@/lib/contract";
import { buildMessages, buildSystemPrompt } from "@/lib/prompt";
import { resolvePlayback } from "@/lib/playback";
import { buildReply, nextPendingState } from "@/lib/reply";
import type {
  CommandRequest,
  FinalResult,
  LatestUploadResult,
  LiveLookupResult,
  PlaybackPlan,
  StreamEvent,
} from "@/lib/api-types";

const MODEL = "claude-opus-5-5";
// Interpreting a short command is a simple task: "low" answers faster and costs less.
const EFFORT = "low" as const;

// We also validate what comes from the browser: the server doesn't trust the client.
const RequestSchema = z.object({
  // What the user said.
  utterance: z.string().trim().min(1).max(500),
  // List of previous turns: what was said and the resulting command.
  // Every string has a length limit (so nobody can send huge texts and burn API credits),
  // and past commands must match the real contract (so nobody can forge fake assistant turns).
  history: z
    .array(z.object({ utterance: z.string().max(500), command: CommandSchema.nullable() }))
    .max(50),
  // If there is a pending request, this holds the original request and the question asked.
  pending: z
    .object({ originalRequest: z.string().max(500), question: z.string().max(500) })
    .nullable(),
  // Requires one of the allowed simulated YouTube scenario values.
  scenario: z.enum(["live_found", "no_live_found", "lookup_failed"]),
  latestScenario: z.enum(["latest_found", "no_uploads", "lookup_failed"]),
});

export async function POST(req: Request): Promise<Response> {
  const parsedBody = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const body = parsedBody.data as CommandRequest;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      try {
        // ---------- 1. Context ----------
        const system = buildSystemPrompt();
        const messages = buildMessages(body.history, body.pending, body.utterance);

        send({
          type: "context",
          log: {
            model: MODEL,
            effort: EFFORT,
            system,
            messages,
            outputSchema: z.toJSONSchema(ModelOutputSchema),
          },
        });

        // ---------- 2. Model call (streaming) ----------
        const client = new Anthropic();
        const modelStream = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 16000,
          system,
          messages,
          output_config: {
            effort: EFFORT,
            format: betaZodOutputFormat(ModelOutputSchema),
          },
          // If the model declines the request due to a safety policy,
          // the API automatically retries with a fallback model.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        });

        for await (const event of modelStream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send({ type: "delta", text: event.delta.text });
          }
        }

        const final = await modelStream.finalMessage();
        const stopReason = final.stop_reason;
        const respondedBy = final.model;

        // If there was a fallback, the valid text is the one AFTER the last "fallback" block.
        const lastFallback = final.content.findLastIndex((b) => b.type === "fallback");
        const rawText = final.content
          .slice(lastFallback + 1)
          .flatMap((b) => (b.type === "text" ? [b.text] : []))
          .join("");

        // ---------- 3. Validation (only now, with the complete object) ----------
        const validation =
          stopReason === "end_turn"
            ? validateModelText(rawText)
            : {
                ok: false as const,
                stage: "incomplete",
                errors: [`The response did not finish properly (stop_reason: ${stopReason}).`],
              };

        // ---------- 4. Execution + external data ----------
        let lookup: LiveLookupResult | null = null;
        let latestUpload: LatestUploadResult | null = null;
        let playback: PlaybackPlan | null = null;
        let channelName: string | null = null;
        let reply: string;
        let nextPending = body.pending; // if something fails, we don't lose the pending request

        if (validation.ok) {
          const command = validation.command;
          if (command.action === "select_channel") {
            const channel = findChannel(command.channelId)!; // already checked in validateModelText
            channelName = channel.name;
            // Live first; if confirmed not live, latest upload (see playback.ts).
            const decision = await resolvePlayback(channel, body.scenario, body.latestScenario);
            lookup = decision.live;
            latestUpload = decision.latestUpload;
            playback = decision.playback;
          }
          reply = buildReply(command, channelName, lookup, latestUpload);
          nextPending = nextPendingState(command, body.utterance, body.pending);
        } else {
          reply = "Sorry, I didn't quite get that. Can you say it again?";
        }

        const result: FinalResult = {
          rawText,
          respondedBy,
          stopReason,
          validation,
          lookup,
          latestUpload,
          playback,
          channelName,
          reply,
          nextPending,
        };
        send({ type: "final", result });
      } catch (error) {
        let message = "Unexpected error.";
        if (error instanceof Anthropic.AuthenticationError) {
          message = "Invalid API key. Check ANTHROPIC_API_KEY in .env.local.";
        } else if (error instanceof Anthropic.RateLimitError) {
          message = "Too many requests in a row. Wait a moment.";
        } else if (error instanceof Anthropic.APIError) {
          // Details stay in the server log; the browser only gets the status code.
          console.error(error);
          message = `API error (${error.status}).`;
        } else {
          console.error(error);
        }
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
