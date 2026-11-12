/**
 * PDF report renderer - turns ReportData into a PDF Buffer.
 *
 * Uses pdfkit (pure-JS, no native deps). The renderer is I/O (writes
 * to a buffer), so it's not unit-tested; the data-prep module is.
 *
 * Layout:
 *  - Cover: title, window, generated-at.
 *  - Summary: one line per stat.
 *  - Equity curve: simple line chart drawn with vector ops.
 *  - Per-pair / per-tag / per-session tables (manual column layout).
 *  - Disclaimer footer.
 */
import PDFDocument from "pdfkit";
import type { ReportData, ReportSummary } from "@/lib/report/data";
import { formatSummaryLines } from "@/lib/report/data";
import { formatMoney, formatPct, formatPair } from "@/lib/trades/schema";

const PAGE_WIDTH = 595.28; // A4 in points
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

/**
 * Render the report data into a PDF Buffer.
 *
 * Returns a Promise<Buffer> because pdfkit is stream-based.
 */
export async function renderReportPdf(data: ReportData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: {
      Title: "ForexMind Performance Report",
      Author: "ForexMind",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  // --- Cover ---
  doc
    .fontSize(20)
    .font("Helvetica-Bold")
    .text("ForexMind Performance Report", MARGIN, MARGIN);
  doc
    .fontSize(10)
    .font("Helvetica")
    .fillColor("#666666")
    .text(
      `Window: ${data.summary.windowStart.slice(0, 10)} to ${data.summary.windowEnd.slice(0, 10)}`,
      MARGIN,
      MARGIN + 30,
    );
  doc
    .fillColor("#666666")
    .text(
      `Generated: ${data.summary.generatedAt.slice(0, 19).replace("T", " ")} UTC`,
      MARGIN,
      MARGIN + 45,
    );
  doc.fillColor("#000000");

  // --- Summary ---
  let y = MARGIN + 80;
  doc.fontSize(13).font("Helvetica-Bold").text("Summary", MARGIN, y);
  y += 22;
  doc.fontSize(10).font("Helvetica");
  for (const line of formatSummaryLines(data.summary)) {
    doc.text(line, MARGIN, y);
    y += 15;
  }

  // --- Equity curve ---
  y += 15;
  if (data.equityCurve.length > 1) {
    doc.fontSize(13).font("Helvetica-Bold").text("Equity curve", MARGIN, y);
    y += 22;
    drawEquityCurve(doc, data.equityCurve.map((p) => p.equity), MARGIN, y, CONTENT_WIDTH, 100);
    y += 120;
  }

  // --- Tables ---
  y = drawSectionTable(doc, data.pairs.title, ["Pair", "Trades", "Win rate", "Net PnL"], data.pairs.rows.map((r) => [formatPair(r.pair), String(r.trades), formatPct(r.winRate), formatMoney(r.netPnl)]), y);
  y = drawSectionTable(doc, data.tags.title, ["Tag", "Trades", "Win rate", "Net PnL"], data.tags.rows.map((r) => [`#${r.tag}`, String(r.trades), formatPct(r.winRate), formatMoney(r.netPnl)]), y);
  y = drawSectionTable(doc, data.sessions.title, ["Session", "Trades", "Win rate", "Net PnL"], data.sessions.rows.map((r) => [r.session, String(r.trades), formatPct(r.winRate), formatMoney(r.netPnl)]), y);

  // --- Disclaimer ---
  if (y > 750) {
    doc.addPage();
    y = MARGIN;
  }
  y += 20;
  doc
    .fontSize(8)
    .fillColor("#999999")
    .font("Helvetica-Oblique")
    .text(
      "Advisory only. ForexMind does not place trades, predict prices, or guarantee outcomes. This report is a summary of trades you logged. Trading foreign exchange involves substantial risk of loss.",
      MARGIN,
      y,
      { width: CONTENT_WIDTH },
    );

  doc.end();
  return done;
}

/** Draw a simple equity-curve line chart. */
function drawEquityCurve(
  doc: InstanceType<typeof PDFDocument>,
  equities: number[],
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  // Frame
  doc.rect(x, y, w, h).strokeColor("#cccccc").lineWidth(0.5).stroke();

  if (equities.length < 2) return;

  const min = Math.min(...equities);
  const max = Math.max(...equities);
  const range = max - min || 1;
  const zeroY = min < 0 ? y + h - ((0 - min) / range) * h : y + h;

  // Zero line if min < 0.
  if (min < 0) {
    doc
      .moveTo(x, zeroY)
      .lineTo(x + w, zeroY)
      .strokeColor("#dddddd")
      .dash(2, { space: 3 })
      .stroke()
      .undash();
  }

  // Equity line.
  doc.strokeColor("#2563eb").lineWidth(1.5);
  for (let i = 0; i < equities.length; i++) {
    const px = x + (i / (equities.length - 1)) * w;
    const py = y + h - ((equities[i]! - min) / range) * h;
    if (i === 0) doc.moveTo(px, py);
    else doc.lineTo(px, py);
  }
  doc.stroke();
}

/** Draw a section with a title + a simple 4-column table. Returns the new y. */
function drawSectionTable(
  doc: InstanceType<typeof PDFDocument>,
  title: string,
  headers: string[],
  rows: string[][],
  startY: number,
): number {
  // Page break if we're near the bottom.
  if (startY > 720) {
    doc.addPage();
    startY = MARGIN;
  }

  let y = startY + 20;
  doc.fontSize(13).font("Helvetica-Bold").fillColor("#000000").text(title, MARGIN, y);
  y += 20;

  // Column widths: first column wider, rest equal.
  const colWidths = [CONTENT_WIDTH * 0.4, CONTENT_WIDTH * 0.2, CONTENT_WIDTH * 0.2, CONTENT_WIDTH * 0.2];

  // Header row.
  doc.fontSize(9).font("Helvetica-Bold");
  let cx = MARGIN;
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i]!, cx, y, { width: colWidths[i], align: i === 0 ? "left" : "right" });
    cx += colWidths[i]!;
  }
  y += 14;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor("#cccccc").lineWidth(0.5).stroke();
  y += 6;

  // Data rows.
  doc.font("Helvetica").fillColor("#000000");
  for (const row of rows) {
    if (y > 770) {
      doc.addPage();
      y = MARGIN;
    }
    cx = MARGIN;
    for (let i = 0; i < row.length; i++) {
      const val = row[i]!;
      // Color the net PnL column (index 3).
      if (i === 3) {
        const n = parseFloat(val.replace(/[^0-9.-]/g, ""));
        if (!Number.isNaN(n)) {
          doc.fillColor(n > 0 ? "#16a34a" : n < 0 ? "#dc2626" : "#000000");
        }
      } else {
        doc.fillColor("#000000");
      }
      doc.text(val, cx, y, { width: colWidths[i], align: i === 0 ? "left" : "right" });
      cx += colWidths[i]!;
    }
    doc.fillColor("#000000");
    y += 14;
  }

  return y;
}
