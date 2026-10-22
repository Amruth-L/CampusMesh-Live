import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, Send, LifeBuoy } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
const field =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-3 text-sm outline-none focus:border-mesh-600";
export default function SupportPage() {
  const { api } = useAuth();
  const [data, setData] = useState({
      turns: [],
      tickets: [],
      aiConfigured: false,
    }),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ticket, setTicket] = useState({ subject: "", details: "" }),
    [ticketBusy, setTicketBusy] = useState(false),
    [notice, setNotice] = useState("");
  const bottom = useRef();
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/api/support");
      setData(data);
    } catch (e) {
      setError(e.response?.data?.error || "Could not load support.");
    }
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);
  const ask = async (e, value) => {
    e?.preventDefault();
    const question = (value || message).trim();
    if (!question || busy) return;
    setBusy(true);
    setError("");
    try {
      const { data: reply } = await api.post("/api/support/chat", {
        message: question,
      });
      setData((d) => ({
        ...d,
        turns: [...d.turns, { id: crypto.randomUUID(), question, ...reply }],
      }));
      setMessage("");
      setTimeout(
        () =>
          bottom.current?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          }),
        50,
      );
    } catch (e) {
      setError(e.response?.data?.error || "Could not answer. Please retry.");
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    setTicketBusy(true);
    try {
      const { data } = await api.post("/api/support/tickets", ticket);
      setNotice(`Support request ${data.id.slice(0, 8)} saved. Status: open.`);
      setTicket({ subject: "", details: "" });
      await load();
    } catch (e) {
      setError(e.response?.data?.error || "Could not save support request.");
    } finally {
      setTicketBusy(false);
    }
  };
  return (
    <main className="page-shell pb-28">
      <header>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-mesh-700">
          CampusMesh care
        </p>
        <h1 className="page-title">How can we help?</h1>
        <p className="page-copy">
          Ask about your rentals, payments, deliveries or Wish Box.
        </p>
      </header>
      <div className="mt-7 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
        <section className="panel overflow-hidden">
          <div className="flex items-center gap-3 border-b border-ink/10 p-4">
            <MessageCircle size={21} className="text-mesh-600" />
            <div>
              <h2 className="text-sm font-semibold">CampusMesh assistant</h2>
              <p className="mt-1 text-xs text-ink/55">
                {data.aiConfigured
                  ? "AI answers grounded in CampusMesh help and your records"
                  : "Help library active · AI connection not configured"}
              </p>
            </div>
          </div>
          <div
            className="max-h-[55vh] min-h-60 space-y-5 overflow-y-auto p-4 sm:p-6"
            aria-live="polite"
          >
            {!data.turns.length && (
              <div>
                <p className="text-sm leading-6 text-ink/65">
                  I can explain the next step or check the records on your
                  account. Never share account OTPs, passwords or payment PINs
                  here.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {[
                    "When are my rentals due?",
                    "How does Wish Box work?",
                    "My payment failed",
                    "How are deliveries matched?",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => ask(null, q)}
                      disabled={busy}
                      className="rounded-full border border-ink/10 px-3 py-2 text-xs hover:bg-mesh-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {data.turns.map((t) => (
              <div key={t.id} className="space-y-3">
                <p className="ml-auto max-w-[90%] rounded-xl bg-ink px-4 py-3 text-sm text-white">
                  {t.question}
                </p>
                <div className="mr-auto rounded-xl bg-paper p-4">
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">
                    {t.answer}
                  </p>
                  <p className="mt-3 text-[10px] text-ink/45">
                    {t.mode === "ai_grounded"
                      ? "AI-assisted answer"
                      : "CampusMesh help & account records"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {t.sources?.map((s) => (
                      <Link
                        key={s.id}
                        to={s.url}
                        className="text-xs font-medium text-mesh-700 underline"
                      >
                        {s.title}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            {busy && (
              <p className="text-sm text-ink/55">Checking CampusMesh help…</p>
            )}
            <div ref={bottom} />
          </div>
          {error && (
            <p
              role="alert"
              className="mx-4 mb-3 rounded-lg bg-red-50 p-3 text-xs text-red-700"
            >
              {error}
            </p>
          )}
          <form
            onSubmit={ask}
            className="flex items-end gap-2 border-t border-ink/10 p-4"
          >
            <label className="flex-1">
              <span className="sr-only">Your question</span>
              <textarea
                maxLength={1500}
                rows={2}
                required
                className={field}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Ask a question…"
              />
            </label>
            <button
              className="brand-button h-12"
              disabled={busy || !message.trim()}
              aria-label="Send question"
            >
              <Send size={17} />
            </button>
          </form>
        </section>
        <aside className="space-y-4">
          <form onSubmit={submit} className="panel space-y-4 p-5">
            <LifeBuoy size={22} className="text-mesh-600" />
            <h2 className="text-lg font-semibold">Need further help?</h2>
            <p className="text-xs leading-5 text-ink/60">
              Save a support request for an unresolved issue. No response time
              is promised.
            </p>
            <label className="block text-xs font-medium">
              Subject
              <input
                className={field + " mt-2"}
                maxLength={150}
                required
                value={ticket.subject}
                onChange={(e) =>
                  setTicket({ ...ticket, subject: e.target.value })
                }
              />
            </label>
            <label className="block text-xs font-medium">
              What happened?
              <textarea
                className={field + " mt-2"}
                maxLength={3000}
                rows={4}
                required
                value={ticket.details}
                onChange={(e) =>
                  setTicket({ ...ticket, details: e.target.value })
                }
              />
            </label>
            <button className="brand-button w-full" disabled={ticketBusy}>
              {ticketBusy ? "Saving…" : "Create support request"}
            </button>
            {notice && (
              <p role="status" className="text-xs text-mesh-700">
                {notice}
              </p>
            )}
          </form>
          {data.tickets.length > 0 && (
            <section className="panel p-5">
              <h2 className="text-sm font-semibold">Your support requests</h2>
              {data.tickets.map((t) => (
                <div key={t.id} className="mt-4 border-t border-ink/10 pt-3">
                  <p className="text-sm font-medium">{t.subject}</p>
                  <span className="text-xs text-ink/55">
                    {t.id.slice(0, 8)} ·{" "}
                    {t.status.toLowerCase().replaceAll("_", " ")}
                  </span>
                </div>
              ))}
            </section>
          )}
          <Link to="/reminders" className="secondary-button w-full">
            Manage reminder calls
          </Link>
        </aside>
      </div>
    </main>
  );
}
