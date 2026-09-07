import 'server-only'

import { formatDate, formatDateTime } from '@/lib/datetime'

import type { CellValue, ColumnDef, ReportResult } from '../types'

/**
 * CSV: the first renderer over the report shape besides the HTML table
 * (AD-5). Adding a format means adding a file here, not touching eleven
 * reports.
 *
 * Two details that decide whether a spreadsheet opens it correctly:
 *
 *  - a UTF-8 byte-order mark, because Excel on Windows otherwise reads
 *    `Ahmed Al Marri` and Arabic names as mojibake;
 *  - CRLF line endings, which is what RFC 4180 says and what Excel expects.
 *
 * A field is quoted whenever it contains a quote, a comma, a line break or
 * leading whitespace, and a leading `=`, `+`, `-` or `@` is prefixed with a
 * single quote so a spreadsheet treats it as text rather than a formula.
 */

const BOM = '﻿'
const CRLF = '\r\n'
const FORMULA_START = /^[=+\-@\t\r]/

function escapeField(value: string): string {
  const guarded = FORMULA_START.test(value) ? `'${value}` : value
  if (/[",\r\n]/.test(guarded) || /^\s|\s$/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`
  }
  return guarded
}

function renderCell(value: CellValue | undefined, column: ColumnDef, timeZone: string): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return column.kind === 'date' ? formatDate(value, timeZone) : formatDateTime(value, timeZone)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return String(value)
  // Statuses read as ENUM_VALUE in the database and as words on a page.
  if (column.kind === 'status' || column.kind === 'severity') return value.toLowerCase().replace(/_/g, ' ')
  return value
}

export interface CsvFile {
  fileName: string
  body: string
  contentType: string
}

/**
 * The report as a CSV file. Every declared column is included - the table
 * hides `secondary` ones on a narrow screen, an export should not.
 */
export function toCsv(result: ReportResult, options: { reportId: string; title: string; timeZone: string; now: Date }): CsvFile {
  const header = result.columns.map((column) => escapeField(column.label)).join(',')
  const lines = result.rows.map((row) => result.columns.map((column) => escapeField(renderCell(row[column.key], column, options.timeZone))).join(','))

  const stamp = options.now.toISOString().slice(0, 10)
  return {
    fileName: `${options.reportId}-${stamp}.csv`,
    body: BOM + [header, ...lines].join(CRLF) + CRLF,
    contentType: 'text/csv; charset=utf-8',
  }
}
