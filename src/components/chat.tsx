"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Msg = {
  id: string; direction: "in" | "out"; kind: string; body: string; status: string; sentBy: string; error: string | null; at: string;
  payload: null | { type?: string; buttons?: { id: string; title: string }[]; rows?: { id: string; title: string; description?: string }[]; button?: string };
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });

/**
 * One chat view for two jobs:
 *  - "sim": the user plays the customer against the real engine. Buttons are tappable.
 *  - "inbox": the user reads a real conversation and answers as the business.
 */
export function Chat({ businessId, conversationId: initial, mode }: { businessId: string; conversationId: string | null; mode: "sim" | "inbox" }) {
  const [cid, setCid] = useState(initial);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [openList, setOpenList] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const count = useRef(0);

  const load = useCallback(async (id: string | null) => {
    if (!id) { setMsgs([]); return; }
    const r = await fetch(`/api/b/${businessId}/conversations/${id}`, { cache: "no-store" });
    if (r.ok) setMsgs((await r.json()).messages);
  }, [businessId]);

  useEffect(() => {
    if (mode === "sim" && !initial) {
      fetch(`/api/b/${businessId}/simulate`).then((r) => r.json()).then((j) => { setCid(j.conversationId); load(j.conversationId); });
    } else load(cid);
    const t = setInterval(() => { if (document.visibilityState === "visible") load(cidRef.current); }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const cidRef = useRef(cid);
  cidRef.current = cid;

  useEffect(() => {
    if (msgs.length !== count.current) { count.current = msgs.length; end.current?.scrollIntoView({ block: "end" }); }
  }, [msgs]);

  async function send(body: { text?: string; replyId?: string; reset?: boolean }) {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      if (mode === "sim") {
        const r = await fetch(`/api/b/${businessId}/simulate`, { method: "POST", body: JSON.stringify(body) });
        if (!r.ok) throw new Error();
        const j = await r.json();
        setCid(j.conversationId);
        await load(j.conversationId);
      } else if (cid) {
        const r = await fetch(`/api/b/${businessId}/conversations/${cid}/reply`, { method: "POST", body: JSON.stringify(body) });
        const j = r.ok ? await r.json() : { ok: false, error: "השליחה נכשלה" };
        if (!j.ok) setErr(j.error ?? "השליחה נכשלה");
        await load(cid);
      }
    } catch { setErr("משהו השתבש. אפשר לנסות שוב"); }
    setBusy(false);
  }

  const lastOut = [...msgs].reverse().find((m) => m.direction === "out");
  // In the simulator the user is the customer, so the customer's bubbles sit on "my" side.
  const mine = (m: Msg) => (mode === "sim" ? m.direction === "in" : m.direction === "out");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto bg-chat px-3 py-4" aria-live="polite">
        {!msgs.length && (
          <p className="mx-auto mt-10 max-w-64 rounded-lg bg-white/70 px-4 py-3 text-center text-sm text-muted">
            {mode === "sim" ? "כתבו הודעה כמו שלקוח היה כותב, למשל \"היי\"." : "אין עדיין הודעות בשיחה הזאת."}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          {msgs.map((m) => {
            const interactive = mode === "sim" && m.id === lastOut?.id && !busy;
            return (
              <div key={m.id} className={`flex flex-col ${mine(m) ? "items-start" : "items-end"}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-1.5 shadow-[0_1px_0_rgba(16,35,28,0.08)] ${mine(m) ? "rounded-tr-sm bg-bubble" : "rounded-tl-sm bg-white"}`}>
                  <p className="whitespace-pre-wrap break-words text-[0.92rem]">{m.body}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[0.68rem] text-muted" dir="ltr">
                    <span>{time(m.at)}</span>
                    {m.direction === "out" && m.sentBy === "human" && <span>נציג</span>}
                    {m.direction === "out" && m.sentBy !== "human" && mode === "inbox" && <span>בוט</span>}
                    {m.status === "failed" && <span className="font-medium text-danger">לא נשלח</span>}
                    {m.status === "read" && <span>נקרא</span>}
                  </p>
                  {m.status === "failed" && m.error && <p className="mt-1 text-[0.72rem] text-danger">{m.error}</p>}
                </div>
                {m.payload?.buttons && (
                  <div className="mt-1 flex max-w-[85%] flex-wrap gap-1">
                    {m.payload.buttons.map((b) => (
                      <button key={b.id} disabled={!interactive} onClick={() => send({ replyId: b.id, text: b.title })}
                        className="rounded-lg bg-white px-3 py-1.5 text-[0.86rem] font-medium text-bottle shadow-[0_1px_0_rgba(16,35,28,0.08)] enabled:hover:bg-mint disabled:text-muted">
                        {b.title}
                      </button>
                    ))}
                  </div>
                )}
                {m.payload?.rows && (
                  <div className="mt-1 w-[85%] max-w-80">
                    <button disabled={!interactive} onClick={() => setOpenList(openList === m.id ? null : m.id)}
                      className="w-full rounded-lg bg-white px-3 py-1.5 text-[0.86rem] font-medium text-bottle shadow-[0_1px_0_rgba(16,35,28,0.08)] enabled:hover:bg-mint disabled:text-muted">
                      ☰ {m.payload.button}
                    </button>
                    {(mode === "inbox" || (interactive && openList === m.id)) && (
                      <ul className="mt-1 overflow-hidden rounded-lg bg-white text-[0.86rem]">
                        {m.payload.rows.map((r) => (
                          <li key={r.id} className="border-b border-line last:border-0">
                            <button disabled={!interactive} onClick={() => { setOpenList(null); send({ replyId: r.id, text: r.title }); }}
                              className="block w-full px-3 py-1.5 text-start enabled:hover:bg-mint">
                              <span className="font-medium">{r.title}</span>
                              {r.description && <span className="block text-[0.76rem] text-muted">{r.description}</span>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div ref={end} />
      </div>
      {err && <p className="bg-danger-soft px-3 py-1.5 text-sm text-danger">{err}</p>}
      {(mode === "sim" || cid) && (
        <form className="flex gap-2 border-t border-line bg-surface p-2.5"
          onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t) { setText(""); send({ text: t }); } }}>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} aria-label="הודעה"
            placeholder={mode === "sim" ? "הודעה בתור לקוח" : "תשובה ללקוח (הבוט יושהה בשיחה הזאת)"} />
          <button className="btn btn-primary" disabled={busy || !text.trim()}>שליחה</button>
          {mode === "sim" && (
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => send({ reset: true })}>שיחה חדשה</button>
          )}
        </form>
      )}
    </div>
  );
}
