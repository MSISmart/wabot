export function Flash({ sp }: { sp: { ok?: string; error?: string } }) {
  if (!sp.ok && !sp.error) return null;
  return (
    <div role="status" className={`mb-5 rounded-lg border px-4 py-2.5 text-sm ${sp.error ? "border-[#e6c2ba] bg-danger-soft text-danger" : "border-[#bcd8cd] bg-mint text-bottle-deep"}`}>
      {sp.error ?? sp.ok}
    </div>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1>{title}</h1>
        {sub && <p className="mt-1 text-muted">{sub}</p>}
      </div>
      {children}
    </div>
  );
}
