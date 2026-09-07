import { formatDate, formatDateTime } from '@/lib/datetime'
import type { FrozenDocument } from '@/server/documents/snapshot'

/**
 * The frozen document on screen, laid out as the printed record.
 *
 * White ground and dark ink whatever the viewer's theme, because this is the
 * page people print or save. Everything shown comes from the snapshot taken
 * when the inspection completed - it never reads the kit or the assets as they
 * are now, so a document opened years later still says what was signed.
 */

const WORDS: Record<string, string> = {
  INCLUDED: 'Handed over',
  MISSING: 'Not returned',
  DAMAGED: 'Damaged',
  NOT_APPLICABLE: 'n/a',
  PASS: 'Pass',
  FAIL: 'Fail',
  INSTALLED: 'Installed',
  NOT_INSTALLED: 'Not installed',
  LICENSE_ISSUE: 'Licence issue',
  NEEDS_UPDATE: 'Needs update',
  GOOD: 'Good',
  MINOR_DAMAGE: 'Minor damage',
}

const word = (value: string | null, fallback = '—') => (value ? (WORDS[value] ?? value.toLowerCase().replace(/_/g, ' ')) : fallback)
const returnWord = (value: string | null) => (value === 'INCLUDED' ? 'Returned' : word(value))

function when(value: string | null, timeZone: string, withTime = true): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return withTime ? formatDateTime(date, timeZone) : formatDate(date, timeZone)
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold text-slate-900">{value}</p>
    </div>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 border-b border-slate-300 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-teal-800">{children}</h2>
}

export function DocumentSheet({
  document,
  title,
  organisation,
  timeZone,
  signatureIds,
}: {
  document: FrozenDocument
  title: string
  organisation: string
  timeZone: string
  /** Signature row ids, so the images can come from the authorised route. */
  signatureIds: Array<{ type: string; id: string }>
}) {
  const isReturn = document.kind === 'return'
  const problems = document.equipment.filter((line) => (isReturn ? line.returnStatus : line.status) === 'MISSING' || (isReturn ? line.returnStatus : line.status) === 'DAMAGED')

  return (
    <article className="mx-auto w-full max-w-4xl bg-white p-8 text-slate-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
      <header className="border-b-2 border-slate-900 pb-4">
        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{organisation}</p>
        <h1 className="mt-1 font-display text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-slate-600">
          <span className="font-mono font-semibold text-slate-900">{document.bookingNumber ?? '—'}</span>
          {document.kit.code ? (
            <>
              {' · '}
              <span className="font-mono">{document.kit.code}</span>
            </>
          ) : null}
          {document.kit.name ? ` · ${document.kit.name}` : ''}
        </p>
      </header>

      <section className="mt-5">
        <Heading>Booking</Heading>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Editor" value={document.editor.name ?? '—'} />
          <Field label="Mobile" value={document.editor.contactNumber ?? '—'} />
          <Field label="Staff ID" value={document.editor.staffId ?? '—'} />
          <Field label={document.editor.type === 'EXTERNAL' ? 'Company' : 'Department'} value={document.editor.company ?? document.editor.department ?? '—'} />
          <Field label="Assigned engineer" value={document.engineer.assigned ?? '—'} />
          <Field label={isReturn ? 'Return received by' : 'Handed over by'} value={(isReturn ? document.engineer.returnReceivedBy : document.engineer.handedOverBy) ?? '—'} />
          <Field label="Collected" value={when(document.collectedAt, timeZone)} />
          <Field label="Expected return" value={when(document.expectedReturnDate, timeZone)} />
          {isReturn ? <Field label="Actual return" value={when(document.returnedAt, timeZone)} /> : null}
          {isReturn ? (
            <Field
              label="Punctuality"
              value={document.punctuality ? (document.punctuality === 'late' ? `Late by ${document.minutesLate ?? 0} min` : document.punctuality.replace('-', ' ')) : '—'}
            />
          ) : null}
          {document.purpose ? <Field label="Purpose" value={document.purpose} /> : null}
          {document.kit.suitcaseStatus ? <Field label="Case condition" value={word(document.kit.suitcaseStatus)} /> : null}
        </div>
        {isReturn && document.measuredAgainst ? (
          <p className="mt-3 text-[11px] text-slate-500">
            Checked against the handover completed {when(document.measuredAgainst.completedAt, timeZone)} ({document.measuredAgainst.lineCount ?? 0} items).
          </p>
        ) : null}
      </section>

      <section className="mt-6">
        <Heading>{isReturn ? `Equipment accounted for (${document.equipment.length})` : `Equipment handed over (${document.equipment.length})`}</Heading>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.12em] text-slate-500">
              <th className="py-1 pr-2 font-semibold">Code</th>
              <th className="py-1 pr-2 font-semibold">Item</th>
              <th className="py-1 pr-2 font-semibold">Serial</th>
              {isReturn ? <th className="py-1 pr-2 font-semibold">Went out</th> : <th className="py-1 pr-2 font-semibold">Make and model</th>}
              <th className="py-1 font-semibold">{isReturn ? 'Came back' : 'Condition'}</th>
            </tr>
          </thead>
          <tbody>
            {document.equipment.map((line, index) => {
              const condition = isReturn ? returnWord(line.returnStatus) : word(line.status)
              const problem = (isReturn ? line.returnStatus : line.status) === 'MISSING' || (isReturn ? line.returnStatus : line.status) === 'DAMAGED'
              return (
                <>
                  <tr key={`${line.assetCode}-${index}`} className="border-t border-slate-200 align-top">
                    <td className="py-1.5 pr-2 font-mono font-semibold">{line.assetCode ?? '—'}</td>
                    <td className="py-1.5 pr-2">{line.name ?? '—'}</td>
                    <td className="py-1.5 pr-2 font-mono text-[11px]">{line.serialNumber ?? '—'}</td>
                    {isReturn ? <td className="py-1.5 pr-2 text-slate-600">{word(line.handoverStatus)}</td> : <td className="py-1.5 pr-2">{[line.manufacturer, line.model].filter(Boolean).join(' ') || '—'}</td>}
                    <td className={`py-1.5 font-semibold ${problem ? 'text-rose-700' : ''}`}>{condition}</td>
                  </tr>
                  {line.accessories.length > 0 || line.notes ? (
                    <tr key={`${line.assetCode}-${index}-detail`}>
                      <td />
                      <td colSpan={4} className="pb-1.5 text-[11px] text-slate-600">
                        {line.accessories.map((accessory, accessoryIndex) => (
                          <span key={accessoryIndex} className="mr-3 inline-block">
                            — {accessory.label ?? accessory.type}
                            {accessory.expected && accessory.expected > 1 ? ` ×${accessory.expected}` : ''}
                            {': '}
                            <span className={accessory.status === 'MISSING' || accessory.status === 'DAMAGED' ? 'font-semibold text-rose-700' : ''}>
                              {isReturn ? returnWord(accessory.status) : word(accessory.status)}
                            </span>
                          </span>
                        ))}
                        {line.notes ? <span className="block italic">Note: {line.notes}</span> : null}
                      </td>
                    </tr>
                  ) : null}
                </>
              )
            })}
          </tbody>
        </table>
      </section>

      {document.checklist.length > 0 ? (
        <section className="mt-6">
          <Heading>
            Checks ({document.checklist.filter((check) => check.status === 'PASS').length} of {document.checklist.length} passed)
          </Heading>
          <ul className="grid gap-1 text-[12px] sm:grid-cols-2">
            {document.checklist.map((check, index) => (
              <li key={index} className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1">
                <span>{check.label ?? '—'}</span>
                <span className={`shrink-0 font-semibold ${check.status === 'FAIL' ? 'text-rose-700' : 'text-slate-600'}`}>{word(check.status, 'not answered')}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {document.software.length > 0 ? (
        <section className="mt-6">
          <Heading>Software ({document.software.length})</Heading>
          <ul className="grid gap-1 text-[12px] sm:grid-cols-2">
            {document.software.map((entry, index) => (
              <li key={index} className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1">
                <span>
                  {entry.name ?? '—'} {entry.version ? <span className="font-mono text-[11px] text-slate-500">{entry.version}</span> : null}
                </span>
                <span className={`shrink-0 font-semibold ${entry.status === 'INSTALLED' ? 'text-slate-600' : 'text-rose-700'}`}>{word(entry.status)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {problems.length > 0 ? (
        <section className="mt-6">
          <Heading>Problems recorded ({problems.length})</Heading>
          <ul className="list-disc space-y-0.5 pl-5 text-[12px]">
            {problems.map((line, index) => (
              <li key={index}>
                <span className="font-mono font-semibold">{line.assetCode}</span> {line.name} — {isReturn ? returnWord(line.returnStatus) : word(line.status)}
                {line.notes ? `: ${line.notes}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {document.generalNotes ? (
        <section className="mt-6">
          <Heading>{isReturn ? 'Return notes' : 'Notes at handover'}</Heading>
          <p className="whitespace-pre-line text-[12px]">{document.generalNotes}</p>
        </section>
      ) : null}

      <section className="mt-8">
        <Heading>Signatures</Heading>
        <div className="grid gap-4 sm:grid-cols-2">
          {document.signatures.map((signature, index) => {
            const image = signatureIds.find((entry) => entry.type === signature.type)
            return (
              <div key={index} className="rounded border border-slate-300 p-3">
                <div className="flex h-16 items-end">
                  {image ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- authorised route, arbitrary dimensions */
                    <img src={`/api/files/signature/${image.id}`} alt={`Signature of ${signature.signerName ?? 'signatory'}`} className="max-h-16 w-auto" />
                  ) : (
                    <span className="text-[11px] italic text-slate-500">(signature on file)</span>
                  )}
                </div>
                <div className="mt-1 border-t border-slate-300 pt-1">
                  <p className="text-[12px] font-semibold">{signature.signerName ?? '—'}</p>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                    {signature.type.replace(/_/g, ' ').toLowerCase()} · {when(signature.signedAt, timeZone)}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </article>
  )
}
