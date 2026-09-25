/**
 * A small, strict CSV reader.
 *
 * Deliberately hand-rolled rather than a dependency: the input is a customer's spreadsheet
 * export, so it has to cope with quoted fields, embedded commas and newlines, and both CRLF and
 * LF — but nothing more exotic than that. Anything it cannot parse becomes a readable error on a
 * numbered line, not a stack trace.
 */

export interface CsvTable {
  /** Lower-cased, underscored header names, in file order. */
  headers: string[];
  /** One entry per data row: the cells, plus the 1-based line number in the original file. */
  rows: { line: number; cells: string[] }[];
}

export function parseCsv(input: string): CsvTable {
  const text = input.replace(/^﻿/, ""); // Excel writes a byte-order mark
  const rows: string[][] = [];
  const lineOf: number[] = [];

  let cell = "";
  let row: string[] = [];
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;

  const endCell = () => {
    row.push(cell.trim());
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== "")) {
      rows.push(row);
      lineOf.push(rowStartLine);
    }
    row = [];
    rowStartLine = line;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'; // an escaped quote inside a quoted field
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      inQuotes = true;
      cell = "";
    } else if (ch === ",") {
      endCell();
    } else if (ch === "\r") {
      // handled by the \n that follows
    } else if (ch === "\n") {
      line++;
      endRow();
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) endRow();

  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0]!.map(normaliseHeader);
  return {
    headers,
    rows: rows.slice(1).map((cells, i) => ({ line: lineOf[i + 1] ?? i + 2, cells })),
  };
}

/** "Contact Name", "contact-name" and "CONTACT_NAME" all mean the same column. */
function normaliseHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/** Read a row into a keyed record, so column order in the customer's file does not matter. */
export function rowToRecord(headers: string[], cells: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((h, i) => {
    out[h] = (cells[i] ?? "").trim();
  });
  return out;
}

/** Quote a value for output only when it needs it. */
export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n");
}
