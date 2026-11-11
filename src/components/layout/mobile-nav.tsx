"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/lib/nav";
import { TrendingDown, Menu, X } from "lucide-react";
import { useState } from "react";

/**
 * Mobile top navigation (< lg). Hamburger toggles a dropdown panel
 * listing the same items as the desktop sidebar.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const activeItem =
    NAV_ITEMS.find((i) =>
      i.href === "/" ? pathname === "/" : pathname.startsWith(i.href),
    ) ?? NAV_ITEMS[0];

  const ActiveIcon = activeItem.icon;

  return (
    <header className="lg:hidden sticky top-0 z-50 bg-card border-b border-border">
      <div className="flex items-center justify-between h-16 px-4">
        <Link
          href="/"
          className="flex items-center gap-2"
          onClick={() => setOpen(false)}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <TrendingDown className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="text-base font-semibold tracking-tight">
            ForexMind
          </span>
        </Link>

        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-nav-panel"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? (
            <X className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Menu className="h-5 w-5" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Current section indicator (visible only when panel closed) */}
      {!open && (
        <div className="px-4 pb-3 -mt-1">
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <ActiveIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {activeItem.label}
          </span>
        </div>
      )}

      {/* Dropdown panel */}
      {open && (
        <nav
          id="mobile-nav-panel"
          className="border-t border-border bg-card px-3 py-3"
          aria-label="Primary navigation (mobile)"
        >
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
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
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
          <p className="mt-3 px-3 text-[11px] leading-relaxed text-muted-foreground">
            Not financial advice. Trading forex involves substantial risk of
            loss.
          </p>
        </nav>
      )}
    </header>
  );
}
