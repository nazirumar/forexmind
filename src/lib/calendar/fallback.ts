/**
 * Deterministic sample economic calendar.
 *
 * Generates a realistic calendar of recurring high-impact forex events
 * relative to "now", so the calendar always shows relevant upcoming
 * events in the sandbox / preview without needing a live API.
 *
 * Events covered (all are real, recurring events that actually move
 * forex markets):
 *  - Non-Farm Payrolls (NFP): first Friday of every month, 13:30 UTC
 *  - FOMC Rate Decision: 8 scheduled meetings/year, ~6 weeks apart
 *  - CPI (US): monthly, mid-month, 13:30 UTC
 *  - ECB Rate Decision: monthly (alternating with press conference), 12:45 UTC
 *  - BOE Rate Decision: monthly, 12:00 UTC
 *  - GDP (US): quarterly, 13:30 UTC
 *  - Retail Sales (US): monthly, 13:30 UTC
 *  - PMI (US): monthly, 14:45 UTC
 *  - Unemployment Claims (US): weekly Thursday, 13:30 UTC
 *
 * In production with a real provider (Finnhub premium, Trading Economics,
 * or ForexFactory scraping), the sample data is never returned.
 *
 * The generator produces events for a window of [now-2d, now+14d] so
 * the user sees recent past events + upcoming ones.
 */
import type { EconomicEvent } from "@/lib/calendar/schema";

/** Generate events for the window [now - pastDays, now + futureDays]. */
export function sampleCalendar(
  nowMs: number = Date.now(),
  pastDays = 2,
  futureDays = 14,
): EconomicEvent[] {
  const events: EconomicEvent[] = [];
  const now = new Date(nowMs);
  const start = new Date(now.getTime() - pastDays * 86_400_000);
  const end = new Date(now.getTime() + futureDays * 86_400_000);

  // --- Non-Farm Payrolls: first Friday of each month, 13:30 UTC ---
  for (const monthStart of monthsInRange(start, end)) {
    const firstFriday = nthWeekdayOfMonth(monthStart, 5, 1); // Friday=5, first=1
    const nfpTime = new Date(firstFriday);
    nfpTime.setUTCHours(13, 30, 0, 0);
    if (inRange(nfpTime, start, end)) {
      events.push(makeEvent({
        time: nfpTime.toISOString(),
        title: "Non-Farm Payrolls",
        currency: "USD",
        impact: "high",
        forecast: "180K",
        previous: "256K",
        source: "BLS",
      }));
    }
  }

  // --- FOMC Rate Decision: ~8 times/year. We approximate as every 6 weeks ---
  // Find the most recent FOMC before "now" (Jan, Mar, May, Jun, Jul, Sep, Nov, Dec)
  const fomcMonths = [0, 2, 4, 5, 6, 8, 10, 11]; // 0-indexed months
  for (const monthStart of monthsInRange(start, end)) {
    if (!fomcMonths.includes(monthStart.getUTCMonth())) continue;
    // FOMC is usually the 2nd Wednesday of the month
    const wed = nthWeekdayOfMonth(monthStart, 3, 2); // Wednesday=3, second=2
    const fomcTime = new Date(wed);
    fomcTime.setUTCHours(19, 0, 0, 0); // 19:00 UTC (2:00 PM ET)
    if (inRange(fomcTime, start, end)) {
      events.push(makeEvent({
        time: fomcTime.toISOString(),
        title: "FOMC Rate Decision",
        currency: "USD",
        impact: "high",
        forecast: "5.50%",
        previous: "5.50%",
        source: "Federal Reserve",
      }));
    }
  }

  // --- US CPI: monthly, mid-month (usually 2nd or 3rd Tuesday), 13:30 UTC ---
  for (const monthStart of monthsInRange(start, end)) {
    const secondTuesday = nthWeekdayOfMonth(monthStart, 2, 2); // Tuesday=2, second=2
    const cpiTime = new Date(secondTuesday);
    cpiTime.setUTCHours(13, 30, 0, 0);
    if (inRange(cpiTime, start, end)) {
      events.push(makeEvent({
        time: cpiTime.toISOString(),
        title: "CPI m/m",
        currency: "USD",
        impact: "high",
        forecast: "0.3%",
        previous: "0.4%",
        source: "BLS",
      }));
    }
  }

  // --- ECB Rate Decision: monthly, first Thursday, 12:45 UTC ---
  for (const monthStart of monthsInRange(start, end)) {
    const firstThursday = nthWeekdayOfMonth(monthStart, 4, 1); // Thursday=4, first=1
    const ecbTime = new Date(firstThursday);
    ecbTime.setUTCHours(12, 45, 0, 0);
    if (inRange(ecbTime, start, end)) {
      events.push(makeEvent({
        time: ecbTime.toISOString(),
        title: "ECB Rate Decision",
        currency: "EUR",
        impact: "high",
        forecast: "4.25%",
        previous: "4.25%",
        source: "ECB",
      }));
    }
  }

  // --- BOE Rate Decision: monthly, Thursday after first Wednesday, 12:00 UTC ---
  for (const monthStart of monthsInRange(start, end)) {
    const firstWednesday = nthWeekdayOfMonth(monthStart, 3, 1);
    const thursday = new Date(firstWednesday);
    thursday.setUTCDate(thursday.getUTCDate() + 1);
    const boeTime = new Date(thursday);
    boeTime.setUTCHours(12, 0, 0, 0);
    if (inRange(boeTime, start, end)) {
      events.push(makeEvent({
        time: boeTime.toISOString(),
        title: "BOE Rate Decision",
        currency: "GBP",
        impact: "high",
        forecast: "5.00%",
        previous: "5.00%",
        source: "Bank of England",
      }));
    }
  }

  // --- US Unemployment Claims: weekly, every Thursday, 13:30 UTC ---
  // Find all Thursdays in the range.
  const thursdays = allThursdaysInRange(start, end);
  for (const thu of thursdays) {
    const claimsTime = new Date(thu);
    claimsTime.setUTCHours(13, 30, 0, 0);
    if (inRange(claimsTime, start, end)) {
      events.push(makeEvent({
        time: claimsTime.toISOString(),
        title: "Unemployment Claims",
        currency: "USD",
        impact: "medium",
        forecast: "221K",
        previous: "219K",
        source: "DOL",
      }));
    }
  }

  // --- US Retail Sales: monthly, mid-month, 13:30 UTC ---
  for (const monthStart of monthsInRange(start, end)) {
    const midMonth = new Date(monthStart);
    midMonth.setUTCDate(15); // ~mid-month; actual day varies
    // Adjust to the nearest weekday
    while (midMonth.getUTCDay() === 0 || midMonth.getUTCDay() === 6) {
      midMonth.setUTCDate(midMonth.getUTCDate() + 1);
    }
    const retailTime = new Date(midMonth);
    retailTime.setUTCHours(13, 30, 0, 0);
    if (inRange(retailTime, start, end)) {
      events.push(makeEvent({
        time: retailTime.toISOString(),
        title: "Retail Sales m/m",
        currency: "USD",
        impact: "medium",
        forecast: "0.3%",
        previous: "0.6%",
        source: "Census Bureau",
      }));
    }
  }

  // Sort by time ascending.
  events.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  return events;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _idCounter = 0;
function makeEvent(e: Omit<EconomicEvent, "id">): EconomicEvent {
  return { id: `sample-${_idCounter++}`, ...e };
}

/** Get the first day of each month that overlaps [start, end]. */
function monthsInRange(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    out.push(new Date(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

/** Get the nth occurrence of a weekday in a month. day: 0=Sun..6=Sat, n: 1=first..5=fifth. */
function nthWeekdayOfMonth(monthStart: Date, day: number, n: number): Date {
  const d = new Date(monthStart);
  // Find the first occurrence of `day` in the month.
  while (d.getUTCDay() !== day) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  // Add (n-1) weeks.
  d.setUTCDate(d.getUTCDate() + (n - 1) * 7);
  return d;
}

/** Get all Thursdays in the range [start, end] (as dates at midnight UTC). */
function allThursdaysInRange(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  // Advance to the first Thursday.
  while (cursor.getUTCDay() !== 4) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  while (cursor <= end) {
    out.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return out;
}

function inRange(d: Date, start: Date, end: Date): boolean {
  return d >= start && d <= end;
}
