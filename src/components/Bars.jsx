// Tiny dependency-free charts.
export function Bars({ items }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="bars">
      {items.map((i) => (
        <li key={i.label}>
          <span className="bl">{i.label}</span>
          <span className="bt"><span className="bf" style={{ width: `${(i.value / max) * 100}%`, background: i.color }} /></span>
          <span className="bv">{i.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function WeekChart({ messages, moods }) {
  const days = Array.from({ length: 7 }, (_, k) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - k)); return d;
  });
  const cols = days.map((d) => {
    const next = new Date(d); next.setDate(next.getDate() + 1);
    const inDay = messages.filter((m) => m.mood && new Date(m.created_at) >= d && new Date(m.created_at) < next);
    return { d, total: inDay.length, parts: moods.map((mo) => ({ ...mo, n: inDay.filter((m) => m.mood === mo.id).length })) };
  });
  const max = Math.max(1, ...cols.map((c) => c.total));
  return (
    <div className="week" role="img" aria-label="Mood messages received in the last 7 days">
      {cols.map((c) => (
        <div className="wcol" key={c.d.toISOString()}>
          <div className="wstack" title={`${c.total} mood messages`}>
            {c.parts.filter((p) => p.n).map((p) => (
              <span key={p.id} style={{ height: `${(p.n / max) * 100}%`, background: p.color }} />
            ))}
          </div>
          <span className="wl">{c.d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
        </div>
      ))}
    </div>
  );
}
