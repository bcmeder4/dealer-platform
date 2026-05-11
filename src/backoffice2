import { useState, useEffect } from "react";

// ============================================================
// AI Reply Review Queue
// Shows inbound email replies with AI classification and drafts
// Dealer reviews, edits if needed, then approves to send
// ============================================================

const MOCK_REPLIES = [
  {
    id: "r1",
    created_at: "2026-05-09T14:22:00Z",
    from_email: "john.smith@gmail.com",
    subject: "Re: 2024 Ford F-150 XLT - Available at Metro Ford Dallas",
    body: "Hey, I'm interested in the F-150. What's your best out the door price? Can I come in Saturday morning?",
    classification: "appointment",
    urgency: "high",
    ai_draft: "Hi John! Great to hear from you. We'd love to have you in Saturday morning — we're open from 9am. The F-150 XLT is priced at $52,990 MSRP and we have current incentives available we can walk through together. I'll make sure it's ready for a test drive. See you Saturday!",
    contact: { first_name: "John", last_name: "Smith" },
    vehicle: { year: 2024, make: "Ford", model: "F-150", trim: "XLT", price: 52990 },
    dealer: "Metro Ford Dallas",
    reviewed: false,
    sent: false,
  },
  {
    id: "r2",
    created_at: "2026-05-09T13:05:00Z",
    from_email: "sarah.jones@yahoo.com",
    subject: "Re: 2024 Ford Explorer XLT - Special Offer",
    body: "Please remove me from your list. Not interested.",
    classification: "unsubscribe",
    urgency: "low",
    ai_draft: "Hi Sarah, I've removed you from our list immediately. You won't receive any further emails from Metro Ford Dallas. Apologies for any inconvenience.",
    contact: { first_name: "Sarah", last_name: "Jones" },
    vehicle: { year: 2024, make: "Ford", model: "Explorer", trim: "XLT", price: 44500 },
    dealer: "Metro Ford Dallas",
    reviewed: false,
    sent: false,
  },
  {
    id: "r3",
    created_at: "2026-05-09T11:30:00Z",
    from_email: "mike.davis@hotmail.com",
    subject: "Re: 2024 Ford Bronco Big Bend",
    body: "Does this come in black? Also what's the towing capacity on this trim?",
    classification: "question",
    urgency: "medium",
    ai_draft: "Hi Mike! The Bronco Big Bend does come in Shadow Black — it's a great looking color on it. Towing capacity on the Big Bend with the 2.3L EcoBoost is 3,500 lbs. Would you like to come in for a test drive so we can go over all the specs in person?",
    contact: { first_name: "Mike", last_name: "Davis" },
    vehicle: { year: 2024, make: "Ford", model: "Bronco", trim: "Big Bend", price: 41200 },
    dealer: "Metro Ford Dallas",
    reviewed: false,
    sent: false,
  },
  {
    id: "r4",
    created_at: "2026-05-09T09:15:00Z",
    from_email: "linda.chen@gmail.com",
    subject: "Re: 2024 Ford Maverick Lariat",
    body: "We already bought a truck last week, but thanks anyway!",
    classification: "not_interested",
    urgency: "low",
    ai_draft: "Hi Linda! Congratulations on your new truck! Hope you enjoy it. Don't hesitate to reach out if we can help with anything in the future — service, accessories, or when you're ready for your next vehicle.",
    contact: { first_name: "Linda", last_name: "Chen" },
    vehicle: { year: 2024, make: "Ford", model: "Maverick", trim: "Lariat", price: 36800 },
    dealer: "Metro Ford Dallas",
    reviewed: false,
    sent: false,
  },
];

const INTENT_CONFIG = {
  appointment:    { label: "Appointment Request", color: "#0ea5e9", bg: "#e0f2fe", icon: "📅" },
  interested:     { label: "Interested",          color: "#16a34a", bg: "#dcfce7", icon: "⭐" },
  price_inquiry:  { label: "Price Inquiry",       color: "#7c3aed", bg: "#ede9fe", icon: "💰" },
  question:       { label: "Question",            color: "#ea580c", bg: "#fff7ed", icon: "❓" },
  unsubscribe:    { label: "Unsubscribe",         color: "#dc2626", bg: "#fee2e2", icon: "🚫" },
  not_interested: { label: "Not Interested",      color: "#64748b", bg: "#f1f5f9", icon: "👋" },
  other:          { label: "Other",               color: "#94a3b8", bg: "#f8fafc", icon: "💬" },
};

const URGENCY_CONFIG = {
  high:   { label: "Urgent",  color: "#dc2626", dot: "#ef4444" },
  medium: { label: "Today",   color: "#ea580c", dot: "#f97316" },
  low:    { label: "Low",     color: "#64748b", dot: "#94a3b8" },
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ReplyQueue() {
  const [replies, setReplies] = useState(MOCK_REPLIES);
  const [selected, setSelected] = useState(null);
  const [editedDraft, setEditedDraft] = useState("");
  const [filter, setFilter] = useState("pending");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(new Set());

  const filtered = replies.filter(r => {
    if (filter === "pending") return !r.reviewed && !sent.has(r.id);
    if (filter === "sent") return sent.has(r.id);
    if (filter === "all") return true;
    return r.classification === filter;
  });

  const pending = replies.filter(r => !r.reviewed && !sent.has(r.id)).length;
  const urgent  = replies.filter(r => r.urgency === "high" && !sent.has(r.id)).length;

  function openReply(reply) {
    setSelected(reply);
    setEditedDraft(reply.ai_draft);
  }

  async function handleSend(reply) {
    setSending(true);
    await new Promise(r => setTimeout(r, 800));
    setSent(prev => new Set([...prev, reply.id]));
    setSelected(null);
    setSending(false);
  }

  function handleSkip(reply) {
    setReplies(prev => prev.map(r => r.id === reply.id ? { ...r, reviewed: true } : r));
    setSelected(null);
  }

  const intentCfg = selected ? INTENT_CONFIG[selected.classification] || INTENT_CONFIG.other : null;
  const urgencyCfg = selected ? URGENCY_CONFIG[selected.urgency] || URGENCY_CONFIG.low : null;

  return (
    <div style={{
      fontFamily: "'DM Sans', 'Sora', system-ui, sans-serif",
      background: "#0f1117",
      minHeight: "100vh",
      color: "#e2e8f0",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        borderBottom: "1px solid #1e2433",
        padding: "16px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#0f1117",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14,
          }}>✉</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em" }}>
              Reply Intelligence
            </div>
            <div style={{ fontSize: 11, color: "#64748b" }}>
              AI-powered response queue
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {urgent > 0 && (
            <div style={{
              background: "#450a0a", color: "#fca5a5",
              borderRadius: 6, padding: "4px 10px",
              fontSize: 12, fontWeight: 500,
              border: "1px solid #7f1d1d",
              display: "flex", alignItems: "center", gap: 5,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", display: "inline-block" }}></span>
              {urgent} urgent
            </div>
          )}
          <div style={{
            background: "#1e2433", color: "#94a3b8",
            borderRadius: 6, padding: "4px 10px",
            fontSize: 12, fontWeight: 500,
            border: "1px solid #2d3748",
          }}>
            {pending} pending
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left panel — reply list */}
        <div style={{
          width: selected ? 340 : "100%",
          borderRight: "1px solid #1e2433",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transition: "width 0.2s",
        }}>
          {/* Filters */}
          <div style={{
            padding: "12px 16px",
            borderBottom: "1px solid #1e2433",
            display: "flex",
            gap: 6,
            overflowX: "auto",
          }}>
            {[
              { key: "pending", label: "Pending" },
              { key: "appointment", label: "📅 Appt" },
              { key: "question", label: "❓ Questions" },
              { key: "interested", label: "⭐ Interested" },
              { key: "unsubscribe", label: "🚫 Unsub" },
              { key: "sent", label: "✓ Sent" },
            ].map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)} style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: "1px solid",
                borderColor: filter === f.key ? "#6366f1" : "#2d3748",
                background: filter === f.key ? "#312e81" : "#1a1f2e",
                color: filter === f.key ? "#a5b4fc" : "#64748b",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
                fontFamily: "inherit",
              }}>{f.label}</button>
            ))}
          </div>

          {/* Reply list */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{
                padding: "48px 24px",
                textAlign: "center",
                color: "#475569",
              }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>All caught up</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>No replies in this category</div>
              </div>
            ) : filtered.map(reply => {
              const ic = INTENT_CONFIG[reply.classification] || INTENT_CONFIG.other;
              const uc = URGENCY_CONFIG[reply.urgency] || URGENCY_CONFIG.low;
              const isSent = sent.has(reply.id);
              return (
                <div key={reply.id}
                  onClick={() => !isSent && openReply(reply)}
                  style={{
                    padding: "14px 16px",
                    borderBottom: "1px solid #1a1f2e",
                    cursor: isSent ? "default" : "pointer",
                    background: selected?.id === reply.id ? "#1a1f2e" : "transparent",
                    transition: "background 0.1s",
                    opacity: isSent ? 0.5 : 1,
                  }}
                  onMouseEnter={e => { if (!isSent && selected?.id !== reply.id) e.currentTarget.style.background = "#141824"; }}
                  onMouseLeave={e => { if (selected?.id !== reply.id) e.currentTarget.style.background = "transparent"; }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    {/* Avatar */}
                    <div style={{
                      width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                      background: `linear-gradient(135deg, ${ic.color}33, ${ic.color}11)`,
                      border: `1px solid ${ic.color}44`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 14,
                    }}>{ic.icon}</div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>
                          {reply.contact.first_name} {reply.contact.last_name}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{
                            width: 6, height: 6, borderRadius: "50%",
                            background: uc.dot, display: "inline-block", flexShrink: 0,
                          }}></span>
                          <span style={{ fontSize: 11, color: "#475569" }}>{timeAgo(reply.created_at)}</span>
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: "#475569", marginTop: 1 }}>
                        {reply.vehicle.year} {reply.vehicle.make} {reply.vehicle.model}
                      </div>
                      <div style={{
                        fontSize: 12, color: "#94a3b8", marginTop: 4,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {reply.body}
                      </div>
                      <div style={{ marginTop: 6, display: "flex", gap: 5 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: "2px 7px",
                          borderRadius: 4, background: ic.bg + "22",
                          color: ic.color, border: `1px solid ${ic.color}33`,
                          letterSpacing: "0.03em", textTransform: "uppercase",
                        }}>{ic.label}</span>
                        {isSent && <span style={{
                          fontSize: 10, fontWeight: 600, padding: "2px 7px",
                          borderRadius: 4, background: "#14532d33",
                          color: "#4ade80", border: "1px solid #14532d",
                          letterSpacing: "0.03em", textTransform: "uppercase",
                        }}>Sent</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right panel — reply detail */}
        {selected && (
          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: "#0d1117",
          }}>
            {/* Detail header */}
            <div style={{
              padding: "16px 20px",
              borderBottom: "1px solid #1e2433",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {selected.contact.first_name} {selected.contact.last_name}
                </div>
                <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
                  {selected.from_email} · {selected.dealer}
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{
                background: "#1e2433", border: "1px solid #2d3748",
                color: "#64748b", borderRadius: 6, padding: "5px 10px",
                cursor: "pointer", fontSize: 12, fontFamily: "inherit",
              }}>✕ Close</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>

              {/* Vehicle context */}
              <div style={{
                background: "#1a1f2e",
                border: "1px solid #2d3748",
                borderRadius: 10,
                padding: "12px 14px",
                marginBottom: 16,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}>
                <div>
                  <div style={{ fontSize: 11, color: "#475569", marginBottom: 3 }}>Vehicle of interest</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {selected.vehicle.year} {selected.vehicle.make} {selected.vehicle.model} {selected.vehicle.trim}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#475569", marginBottom: 3 }}>MSRP</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#6366f1" }}>
                    ${selected.vehicle.price.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Classification badges */}
              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                <div style={{
                  padding: "5px 12px", borderRadius: 6,
                  background: intentCfg.bg + "22",
                  color: intentCfg.color,
                  border: `1px solid ${intentCfg.color}44`,
                  fontSize: 12, fontWeight: 600,
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                  {intentCfg.icon} {intentCfg.label}
                </div>
                <div style={{
                  padding: "5px 12px", borderRadius: 6,
                  background: "#1e2433",
                  color: urgencyCfg.color,
                  border: "1px solid #2d3748",
                  fontSize: 12, fontWeight: 600,
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: urgencyCfg.dot, display: "inline-block" }}></span>
                  {urgencyCfg.label} priority
                </div>
              </div>

              {/* Their message */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "#475569", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
                  Their reply
                </div>
                <div style={{
                  background: "#1a1f2e",
                  border: "1px solid #2d3748",
                  borderRadius: 10,
                  padding: "14px 16px",
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: "#cbd5e1",
                }}>
                  {selected.body}
                </div>
              </div>

              {/* AI Draft */}
              <div style={{ marginBottom: 20 }}>
                <div style={{
                  fontSize: 11, color: "#475569", marginBottom: 8,
                  textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600,
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  <span style={{
                    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                    borderRadius: 4, padding: "1px 6px",
                    color: "#fff", fontSize: 9, fontWeight: 700,
                    letterSpacing: "0.05em",
                  }}>AI</span>
                  Suggested reply — edit before sending
                </div>
                <textarea
                  value={editedDraft}
                  onChange={e => setEditedDraft(e.target.value)}
                  style={{
                    width: "100%",
                    minHeight: 140,
                    background: "#141824",
                    border: "1px solid #2d3748",
                    borderRadius: 10,
                    padding: "14px 16px",
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: "#e2e8f0",
                    resize: "vertical",
                    fontFamily: "inherit",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                  onFocus={e => e.target.style.borderColor = "#6366f1"}
                  onBlur={e => e.target.style.borderColor = "#2d3748"}
                />
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => handleSend(selected)}
                  disabled={sending}
                  style={{
                    flex: 1,
                    padding: "11px",
                    borderRadius: 8,
                    background: sending ? "#312e81" : "linear-gradient(135deg, #4f46e5, #7c3aed)",
                    border: "none",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: sending ? "wait" : "pointer",
                    fontFamily: "inherit",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {sending ? "Sending..." : "✓ Approve & Send"}
                </button>
                <button
                  onClick={() => handleSkip(selected)}
                  style={{
                    padding: "11px 16px",
                    borderRadius: 8,
                    background: "#1a1f2e",
                    border: "1px solid #2d3748",
                    color: "#64748b",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Skip
                </button>
              </div>

              {selected.classification === "unsubscribe" && (
                <div style={{
                  marginTop: 12,
                  padding: "10px 14px",
                  background: "#450a0a22",
                  border: "1px solid #7f1d1d44",
                  borderRadius: 8,
                  fontSize: 11,
                  color: "#fca5a5",
                  lineHeight: 1.5,
                }}>
                  ⚠ This contact has been automatically unsubscribed. Sending a reply is optional but recommended for good practice.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

