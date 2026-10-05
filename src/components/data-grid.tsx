"use client";

// AG Grid (Community) styled with SettleAI's tokens. Server pages pass plain rows plus a serializable column
// spec; formatting, links and status pills are resolved here, in the client.
import { AllCommunityModule, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { formatMinor } from "@/core/money";

export type ColumnKind = "text" | "money" | "datetime" | "status" | "link" | "code" | "number" | "percent";

export interface ColumnSpec {
  field: string;
  header: string;
  kind?: ColumnKind;
  width?: number;
  flex?: number;
  /** status: value -> tone; link: the row field holding the href (default "link") */
  tones?: Record<string, "good" | "warn" | "bad" | "info" | "neutral">;
  hrefField?: string;
  hide?: boolean;
}

const TONE_CLASS = {
  good: "bg-seal-wash text-seal",
  warn: "bg-hold-wash text-hold",
  bad: "bg-deny-wash text-deny",
  info: "bg-[#e6ebfe] text-signal-ink",
  neutral: "bg-vellum text-ink-soft",
} as const;

const theme = themeQuartz.withParams({
  fontFamily: "var(--font-schibsted), system-ui, sans-serif",
  fontSize: 13,
  foregroundColor: "#14213d",
  backgroundColor: "#ffffff",
  accentColor: "#2b4bee",
  borderColor: "#e3e9f2",
  headerBackgroundColor: "#f6f8fb",
  headerTextColor: "#46536e",
  headerFontWeight: 600,
  rowHoverColor: "#f6f8fb",
  wrapperBorderRadius: 10,
  spacing: 7,
});

const MODULES = [AllCommunityModule];

function fmtDate(v: unknown): string {
  if (!v) return "";
  return new Date(String(v)).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
}

function toColDef(c: ColumnSpec): ColDef {
  const base: ColDef = { field: c.field, headerName: c.header, width: c.width, flex: c.flex ?? (c.width ? undefined : 1), hide: c.hide, sortable: true, filter: true, resizable: true };
  switch (c.kind) {
    case "money":
      return { ...base, type: "rightAligned", filter: "agNumberColumnFilter", valueFormatter: (p) => (p.value === null || p.value === undefined ? "" : formatMinor(Number(p.value))), cellClass: "num" };
    case "number":
      return { ...base, type: "rightAligned", filter: "agNumberColumnFilter", cellClass: "num" };
    case "percent":
      return { ...base, type: "rightAligned", filter: "agNumberColumnFilter", valueFormatter: (p) => (p.value === null || p.value === undefined ? "" : `${p.value}%`), cellClass: "num" };
    case "datetime":
      return { ...base, filter: "agDateColumnFilter", valueFormatter: (p) => fmtDate(p.value), sort: undefined };
    case "code":
      return { ...base, cellClass: "font-mono text-xs" };
    case "status":
      return {
        ...base,
        cellRenderer: (p: ICellRendererParams) =>
          p.value ? <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold leading-5 ${TONE_CLASS[c.tones?.[String(p.value)] ?? "neutral"]}`}>{String(p.value).replaceAll("_", " ").toLowerCase()}</span> : null,
      };
    case "link":
      return {
        ...base,
        cellRenderer: (p: ICellRendererParams) => {
          const href = (p.data as Record<string, string>)[c.hrefField ?? "link"];
          return href ? (
            <Link href={href} className="font-semibold text-ink hover:text-signal">
              {String(p.value ?? "")}
            </Link>
          ) : (
            String(p.value ?? "")
          );
        },
      };
    default:
      return base;
  }
}

export function DataGrid({
  rows,
  columns,
  exportName,
  height = 520,
  emptyMessage = "Nothing here yet.",
}: {
  rows: Record<string, unknown>[];
  columns: ColumnSpec[];
  exportName: string;
  height?: number;
  emptyMessage?: string;
}) {
  const ref = useRef<AgGridReact>(null);
  const [quick, setQuick] = useState("");
  const colDefs = useMemo(() => columns.map(toColDef), [columns]);
  return (
    <AgGridProvider modules={MODULES}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="Search every column"
          aria-label="Search the table"
          className="w-64 max-w-full rounded-md border border-vellum bg-surface px-3 py-1.5 text-sm outline-none focus:border-signal"
        />
        <div className="flex items-center gap-3 text-sm text-ink-soft">
          <span className="num">{rows.length} rows</span>
          <button
            type="button"
            onClick={() => ref.current?.api.exportDataAsCsv({ fileName: `${exportName}.csv` })}
            className="rounded-md border border-vellum bg-surface px-3 py-1.5 font-semibold text-ink hover:border-ink-faint"
          >
            Export CSV
          </button>
        </div>
      </div>
      <div style={{ height }}>
        <AgGridReact
          ref={ref}
          theme={theme}
          rowData={rows}
          columnDefs={colDefs}
          quickFilterText={quick}
          pagination={rows.length > 50}
          paginationPageSize={50}
          paginationPageSizeSelector={[25, 50, 100]}
          overlayNoRowsTemplate={`<span class="text-sm">${emptyMessage}</span>`}
          enableCellTextSelection
          ensureDomOrder
        />
      </div>
    </AgGridProvider>
  );
}
