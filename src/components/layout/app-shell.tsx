/**
 * App shell: composes the desktop sidebar, the mobile top nav and the
 * page content area, with the footer pinned to the bottom.
 *
 * Layout:
 *  - lg+ : fixed left sidebar (w-64) + main content with left margin
 *  - <lg : sticky top nav + main content below
 *
 * The whole thing sits in a min-h-screen flex-col so the footer is
 * always at the bottom (sticky on short pages, pushed down on long).
 */
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Footer } from "@/components/layout/footer";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <Sidebar />
      <MobileNav />

      <div className="flex-1 lg:pl-64 flex flex-col">
        <main
          id="main-content"
          className="flex-1 w-full mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          {children}
        </main>
        <Footer />
      </div>
    </div>
  );
}
