/**
 * Footer with the mandatory risk disclaimer.
 *
 * Shown on every page via the root layout. The wording is fixed by
 * the product rules: "Not financial advice. Trading forex involves
 * substantial risk of loss."
 *
 * Layout note: the root wrapper uses min-h-screen flex flex-col, and
 * this footer sits with mt-auto so it sticks to the bottom on short
 * pages and is pushed down naturally on long pages.
 */
export function Footer() {
  return (
    <footer
      className="mt-auto border-t border-border bg-card/50"
      role="contentinfo"
    >
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <p className="text-center text-[11px] sm:text-xs leading-relaxed text-muted-foreground">
          Not financial advice. Trading forex involves substantial risk of
          loss.
        </p>
      </div>
    </footer>
  );
}
