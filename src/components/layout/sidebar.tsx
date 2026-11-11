"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/lib/nav";
import { TrendingDown } from "lucide-react";

/**
 * Desktop sidebar (>= lg). Fixed width, full-height, sticky.
 * Hidden below lg; the mobile nav in a top bar takes over.
 */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 lg:z-40 bg-card border-r border-border"
      aria-label="Primary navigation"
    >
      <div className="flex items-center gap-2 px-6 h-16 border-b border-border">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <TrendingDown className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-base font-semibold tracking-tight">
            ForexMind
          </span>
          <span className="text-[11px] text-muted-foreground">
            AI risk assistant
          </span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="px-6 py-4 border-t border-border">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Not financial advice. Trading forex involves substantial risk of
          loss.
        </p>
      </div>
    </aside>
  );
}
