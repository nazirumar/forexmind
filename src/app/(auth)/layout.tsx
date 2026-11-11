/**
 * Layout for auth pages (login / signup).
 *
 * Minimal centered layout - no sidebar, no app chrome. These pages
 * are public: middleware lets signed-out users through and redirects
 * signed-in users away to the dashboard.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground px-4 py-10">
      <main id="main-content" className="w-full max-w-md">
        {children}
      </main>
      <p className="mt-8 text-center text-[11px] leading-relaxed text-muted-foreground">
        Not financial advice. Trading forex involves substantial risk of loss.
      </p>
    </div>
  );
}
