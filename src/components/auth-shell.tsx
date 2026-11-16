export function AuthShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-[14px_14px_14px_4px] bg-bottle text-lg text-white" aria-hidden>✓</span>
          <div>
            <h1 className="!text-xl">{title}</h1>
            <p className="text-sm text-muted">{sub}</p>
          </div>
        </div>
        <div className="panel p-6">{children}</div>
      </div>
    </main>
  );
}
