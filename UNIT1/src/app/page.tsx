"use client";
// Radio simulator. It is a Client Component ("use client") because it uses
// React state, events, and reads the /api/command stream in the browser.
//
// Left column: what the listener would see/hear (the radio).
// Right column: the "inspector", what happens inside on every turn.

import { useRef, useState } from "react";
import styles from "./page.module.css";
import type {
  CallLog,
  CommandRequest,
  FinalResult,
  HistoryTurn,
  LatestUploadScenario,
  LookupScenario,
  PendingClarification,
  StreamEvent,
} from "@/lib/api-types";

interface Turn {
  id: number;
  utterance: string;
  result: FinalResult | null;
  error: string | null;
}

type PlayerState =
  | { status: "idle" }
  | { status: "loading"; channelName: string; kind: PlaybackKind }
  | { status: "playing"; channelName: string; title: string; kind: PlaybackKind };

type PlaybackKind = "live" | "latest_upload";

const SCENARIOS: { value: LookupScenario; label: string }[] = [
  { value: "live_found", label: "live_found · stream is live" },
  { value: "no_live_found", label: "no_live_found · no live stream" },
  { value: "lookup_failed", label: "lookup_failed · lookup error" },
];

const LATEST_SCENARIOS: { value: LatestUploadScenario; label: string }[] = [
  { value: "latest_found", label: "latest_found · has a latest video" },
  { value: "no_uploads", label: "no_uploads · channel has no videos" },
  { value: "lookup_failed", label: "lookup_failed · lookup error" },
];

const EXAMPLES = ["Play OLGA", "Play the usual one", "OLGA", "Play urbana", "Turn up the volume"];
const MAX_VISIBLE_TURNS = 8;

export default function Home() {
  const [input, setInput] = useState("");
  const [scenario, setScenario] = useState<LookupScenario>("live_found");
  const [latestScenario, setLatestScenario] = useState<LatestUploadScenario>("latest_found");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<PendingClarification | null>(null);
  const [player, setPlayer] = useState<PlayerState>({ status: "idle" });

  // Inspector for the current turn
  const [log, setLog] = useState<CallLog | null>(null);
  const [fragments, setFragments] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<FinalResult | null>(null);

  // Copies in refs: when we chain several commands in a row (the "try all 3
  // results" button), the React state captured in this render becomes stale.
  // Refs always hold the latest value.
  const turnsRef = useRef<Turn[]>([]);
  const pendingRef = useRef<PendingClarification | null>(null);
  const nextId = useRef(1);

  function updateTurns(next: Turn[]) {
    turnsRef.current = next;
    setTurns(next);
  }
  function updatePending(next: PendingClarification | null) {
    pendingRef.current = next;
    setPending(next);
  }

  

  /**
   * Sends one listener command to the server and renders the turn as it streams in.
   *
   * 1. Adds the turn to the history and clears the inspector.
   * 2. Builds the request body: the utterance, the history of finished turns,
   *    the pending clarification (if any), and the selected simulated scenarios.
   * 3. POSTs it to `/api/command`.
   * 4. Reads the response as NDJSON (one JSON object per line). Network chunks
   *    don't respect line boundaries, so bytes are accumulated in a buffer and
   *    split on "\n"; the last (possibly incomplete) piece stays in the buffer
   *    until the next chunk completes it.
   * 5. Each complete line is an event handled by `handleEvent`:
   *    - `context` → fills panel 1 (model call log)
   *    - `delta`   → appends a fragment to panel 2 (display only)
   *    - `final`   → stores the result, updates `pending`, and if there is a
   *                  playback plan, sets the player to "loading" and to
   *                  "playing" after 700 ms
   *    - `error`   → marks the turn as failed
   *
   * @param utterance     What the listener said.
   * @param scenarioToUse Simulated YouTube live-lookup result for this turn.
   */
  async function sendCommand(utterance: string, scenarioToUse: LookupScenario) {
    const text = utterance.trim();
    if (!text) return;

    const turnId = nextId.current++;
    updateTurns([...turnsRef.current, { id: turnId, utterance: text, result: null, error: null }]);
    setLog(null);
    setFragments([]);
    setLastResult(null);

    // History sent to the model: only finished turns.
    const history: HistoryTurn[] = turnsRef.current
      .filter((t) => t.result)
      .map((t) => ({
        utterance: t.utterance,
        command: t.result!.validation.ok ? t.result!.validation.command : null,
      }));

    const body: CommandRequest = {
      utterance: text,
      history,
      pending: pendingRef.current,
      scenario: scenarioToUse,
      latestScenario,
    };

    const patchTurn = (patch: Partial<Turn>) =>
      updateTurns(turnsRef.current.map((t) => (t.id === turnId ? { ...t, ...patch } : t)));

    try {
      const res = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      // Reading NDJSON: bytes arrive, we buffer them and split on "\n".
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) handleEvent(JSON.parse(line) as StreamEvent);
        }
      }
    } catch (e) {
      patchTurn({ error: e instanceof Error ? e.message : String(e) });
    }

    function handleEvent(event: StreamEvent) {
      switch (event.type) {
        case "context":
          setLog(event.log);
          break;
        case "delta":
          // Only DISPLAYED. Nothing is interpreted or executed from a fragment.
          setFragments((f) => [...f, event.text]);
          break;
        case "error":
          patchTurn({ error: event.message });
          break;
        case "final": {
          const r = event.result;
          setLastResult(r);
          patchTurn({ result: r });
          updatePending(r.nextPending);

          // The player is what confirms that something is actually playing.
          // It plays whatever the server's playback plan says: live or latest upload.
          if (r.playback && r.channelName) {
            const name = r.channelName;
            const { title, kind } = r.playback;
            setPlayer({ status: "loading", channelName: name, kind });
            setTimeout(() => setPlayer({ status: "playing", channelName: name, title, kind }), 700);
          }
          break;
        }
      }
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const text = input;
    setInput("");
    // Wait until the whole stream has been processed before freeing `busy`
    await sendCommand(text, scenario);
    setBusy(false);
  }

  async function runExample(text: string) {
    if (busy) return;
    setBusy(true);
    await sendCommand(text, scenario);
    setBusy(false);
  }

  /** Same command, three different YouTube results. */
  async function runAllScenarios() {
    if (busy) return;
    setBusy(true);
    for (const s of SCENARIOS) {
      setScenario(s.value);
      await sendCommand("Play OLGA", s.value);
    }
    setBusy(false);
  }

  function reset() {
    updateTurns([]);
    updatePending(null);
    setPlayer({ status: "idle" });
    setLog(null);
    setFragments([]);
    setLastResult(null);
  }

  const lastTurn = turns.at(-1);
  const radioSays = lastTurn?.error
    ? `⚠ ${lastTurn.error}`
    : lastTurn?.result?.reply ?? (lastTurn ? "…" : "Tell me which channel you want to listen to.");

  return (
    <main className={styles.main}>
      {/* ---------------- Radio ---------------- */}
      <section className={styles.radio}>
        <header className={styles.header}>
          <h1>Live Radio</h1>
          <span className={styles.sub}>voice command simulator</span>
        </header>

        <div className={styles.display}>
          <div className={styles.displayLabel}>The radio says</div>
          <div className={styles.displayText}>{radioSays}</div>
          {pending && (
            <div className={styles.pendingBadge}>
              Waiting for an answer to: “{pending.originalRequest}”
            </div>
          )}
        </div>

        <div className={styles.player} data-status={player.status}>
          <span className={styles.dot} />
          {player.status === "idle" && <span>Player stopped</span>}
          {player.status === "loading" && <span>Loading {player.channelName}…</span>}
          {player.status === "playing" && (
            <span>
              ▶ <span className={styles.kindTag} data-kind={player.kind}>
                {player.kind === "live" ? "LIVE" : "LATEST VIDEO"}
              </span>{" "}
              <strong>{player.channelName}</strong> · {player.title}
            </span>
          )}
        </div>

        <form onSubmit={onSubmit} className={styles.form}>
          <input
            className={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="What you'd say into the mic…"
            disabled={busy}
            autoFocus
          />
          <button className={styles.button} disabled={busy || !input.trim()}>
            {busy ? "…" : "Send"}
          </button>
        </form>

        <div className={styles.chips}>
          {EXAMPLES.map((ex) => (
            <button key={ex} className={styles.chip} onClick={() => runExample(ex)} disabled={busy}>
              {ex}
            </button>
          ))}
        </div>

        <div className={styles.controls}>
          <label className={styles.label}>
            YouTube (simulated) responds:
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value as LookupScenario)}
              disabled={busy}
              className={styles.select}
            >
              {SCENARIOS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.label}>
            If there&apos;s no live stream, latest-video lookup (simulated) responds:
            <select
              value={latestScenario}
              onChange={(e) => setLatestScenario(e.target.value as LatestUploadScenario)}
              disabled={busy}
              className={styles.select}
            >
              {LATEST_SCENARIOS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button className={styles.secondary} onClick={runAllScenarios} disabled={busy}>
            Try “Play OLGA” with all 3 results
          </button>
          <button className={styles.secondary} onClick={reset} disabled={busy}>
            Reset
          </button>
        </div>

        <h2 className={styles.h2}>History</h2>
        <ol className={styles.history}>
          {turns.length === 0 && <li className={styles.empty}>No turns yet.</li>}
          {turns.slice(-MAX_VISIBLE_TURNS).map((t) => (
            <li key={t.id} className={styles.turn}>
              <div className={styles.you}>🎙 {t.utterance}</div>
              <div className={styles.bot}>
                📻 {t.error ? `⚠ ${t.error}` : t.result?.reply ?? "…"}
              </div>
              {t.result && <ActionTag result={t.result} />}
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------- Inspector ---------------- */}
      <section className={styles.inspector}>
        <Panel n={1} title="Model call log">
          {log ? (
            <>
              <p className={styles.meta}>
                Model: <code>{log.model}</code> · effort: <code>{log.effort}</code>
              </p>
              <details>
                <summary>system (rules + catalog)</summary>
                <pre className={styles.pre}>{log.system}</pre>
              </details>
              <details open>
                <summary>messages ({log.messages.length})</summary>
                {log.messages.map((m, i) => (
                  <div key={i} className={styles.msg}>
                    <span className={styles.role}>{m.role}</span>
                    <pre className={styles.pre}>{m.content}</pre>
                  </div>
                ))}
              </details>
              <details>
                <summary>output schema (JSON Schema)</summary>
                <pre className={styles.pre}>{JSON.stringify(log.outputSchema, null, 2)}</pre>
              </details>
            </>
          ) : (
            <p className={styles.empty}>Send a command to see the context.</p>
          )}
        </Panel>

        <Panel n={2} title="Streaming fragments (display only)">
          {fragments.length ? (
            <pre className={styles.pre}>
              {fragments.map((f, i) => (
                <span key={i} className={styles.frag}>
                  {f}
                </span>
              ))}
            </pre>
          ) : (
            <p className={styles.empty}>—</p>
          )}
        </Panel>

        <Panel n={3} title="Complete object + validation (Zod + catalog)">
          {lastResult ? (
            <>
              <p className={styles.meta}>
                stop_reason: <code>{lastResult.stopReason}</code> · answered by:{" "}
                <code>{lastResult.respondedBy}</code>
              </p>
              {lastResult.validation.ok ? (
                <>
                  <span className={styles.okTag}>✓ valid → executed</span>
                  <pre className={styles.pre}>
                    {JSON.stringify(lastResult.validation.command, null, 2)}
                  </pre>
                </>
              ) : (
                <>
                  <span className={styles.errTag}>
                    ✗ invalid ({lastResult.validation.stage}) → not executed
                  </span>
                  <ul>
                    {lastResult.validation.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                  <pre className={styles.pre}>{lastResult.rawText}</pre>
                </>
              )}
            </>
          ) : (
            <p className={styles.empty}>—</p>
          )}
        </Panel>

        <Panel n={4} title="YouTube lookups (SIMULATED) + playback plan">
          {lastResult?.lookup ? (
            <>
              <p className={styles.meta}>a) Is the channel live?</p>
              <pre className={styles.pre}>{JSON.stringify(lastResult.lookup, null, 2)}</pre>
              {lastResult.latestUpload && (
                <>
                  <p className={styles.meta}>b) Not live → latest upload?</p>
                  <pre className={styles.pre}>
                    {JSON.stringify(lastResult.latestUpload, null, 2)}
                  </pre>
                </>
              )}
              <p className={styles.meta}>Playback plan (decided by code)</p>
              <pre className={styles.pre}>{JSON.stringify(lastResult.playback, null, 2)}</pre>
            </>
          ) : (
            <p className={styles.empty}>
              Only queried when the validated action is select_channel.
            </p>
          )}
        </Panel>

        <Panel n={5} title="Conversational state (for the next turn)">
          <pre className={styles.pre}>{JSON.stringify({ pending }, null, 2)}</pre>
        </Panel>
      </section>
    </main>
  );
}

function Panel({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className={styles.panel}>
      <h3 className={styles.panelTitle}>
        <span className={styles.num}>{n}</span> {title}
      </h3>
      {children}
    </div>
  );
}

function ActionTag({ result }: { result: FinalResult }) {
  if (!result.validation.ok) return <span className={styles.errTag}>invalid</span>;
  const c = result.validation.command;
  return (
    <span className={styles.tag}>
      {c.action}
      {c.action === "select_channel" && ` · ${result.channelName}`}
      {result.lookup && ` · ${result.lookup.status}`}
      {result.latestUpload && ` → ${result.latestUpload.status}`}
      {result.lookup && " (simulated)"}
    </span>
  );
}
