/**
 * Layout for the main app (route group "(app)").
 *
 * Everything rendered here sits inside the AppShell (sidebar + mobile
 * nav + footer). These are the protected pages; middleware redirects
 * signed-out users to /login before this layout ever renders.
 */
import { AppShell } from "@/components/layout/app-shell";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
