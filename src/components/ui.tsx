"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFormStatus } from "react-dom";

export function Submit({ children, className = "btn btn-primary", confirm }: { children: React.ReactNode; className?: string; confirm?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}
      onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {pending ? "רגע…" : children}
    </button>
  );
}

export function NavLink({ href, exact, children }: { href: string; exact?: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const active = exact ? path === href : path.startsWith(href);
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[0.93rem] whitespace-nowrap ${active ? "bg-white/15 font-medium text-white" : "text-white/75 hover:bg-white/10 hover:text-white"}`}>
      {children}
    </Link>
  );
}

export function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex gap-2">
        <input className="input font-mono text-[0.8rem]" dir="ltr" readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn btn-quiet" onClick={(e) => {
          navigator.clipboard.writeText(value);
          const b = e.currentTarget; b.textContent = "הועתק"; setTimeout(() => { b.textContent = "העתקה"; }, 1500);
        }}>העתקה</button>
      </div>
    </div>
  );
}
