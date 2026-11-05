import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { STATUS_LABELS, formatDateIST, type ReviewListRow } from '@fap/shared';
import { Badge } from './ui';

interface ReviewTableProps {
  rows: ReviewListRow[];
  /** Where a row's Application ID links to. */
  linkTo: (row: ReviewListRow) => string;
  /** Extra per-row action (e.g. Pick Up). */
  action?: (row: ReviewListRow) => ReactNode;
  showStatus?: boolean;
  /** Manager lists show the Accounts approval (and reference number) instead of the assignee; Admin lists show both. */
  variant?: 'accounts' | 'manager' | 'admin';
}

/** Applications list (PRD A2): a table on wide screens, cards on phones. */
export function ReviewTable({ rows, linkTo, action, showStatus, variant = 'accounts' }: ReviewTableProps) {
  const manager = variant === 'manager';
  const admin = variant === 'admin';
  if (admin) showStatus = true;
  const responsible = (r: ReviewListRow) =>
    admin ? (
      r.agreementReferenceNo ? (
        <span className="font-medium text-slate-900">{r.agreementReferenceNo}</span>
      ) : r.status === 'pending_accounts' ? (
        r.assignedTo?.name ?? <span className="text-slate-500">Unassigned</span>
      ) : (
        <span className="text-slate-500">—</span>
      )
    ) : manager ? (
      r.agreementReferenceNo ? (
        <span className="font-medium text-slate-900">{r.agreementReferenceNo}</span>
      ) : r.accountsApprovedBy ? (
        <span>
          {r.accountsApprovedBy}
          {r.accountsApprovedAt && <span className="block text-xs text-slate-500">{formatDateIST(r.accountsApprovedAt)}</span>}
        </span>
      ) : (
        <span className="text-slate-500">—</span>
      )
    ) : (
      r.assignedTo?.name ?? <span className="text-slate-500">Unassigned</span>
    );
  const responsibleLabel = admin ? 'Assigned / Reference' : manager ? (rows.some((r) => r.agreementReferenceNo) ? 'Reference / Accounts approval' : 'Accounts approved') : 'Assigned To';
  const waiting = (r: ReviewListRow) => (
    <span className={r.overdue ? 'font-semibold text-red-700' : ''}>
      {r.businessDaysWaiting} day{r.businessDaysWaiting === 1 ? '' : 's'}
      {r.overdue && ' · overdue'}
    </span>
  );
  const flags = (r: ReviewListRow) => (
    <span className="flex flex-wrap gap-1">
      {r.hasOpenDuplicateFlag && <Badge color="amber">⚠ Possible duplicate</Badge>}
      {r.resubmissionCount > 0 && <Badge color="blue">Resubmitted ×{r.resubmissionCount}</Badge>}
    </span>
  );

  return (
    <>
      {/* Desktop / tablet */}
      <div className="card hidden overflow-x-auto p-0 lg:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Application ID</th>
              <th className="px-3 py-2">Firm</th>
              <th className="px-3 py-2">PAN</th>
              <th className="px-3 py-2">Signatory</th>
              <th className="px-3 py-2">Submitted</th>
              <th className="px-3 py-2">Waiting</th>
              <th className="px-3 py-2">{responsibleLabel}</th>
              <th className="px-3 py-2">Flags</th>
              {action && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-3 py-2">
                  <Link to={linkTo(r)} className="font-medium text-brand hover:underline">
                    {r.applicationId || 'Not yet verified'}
                  </Link>
                  {showStatus && <div className="mt-1 text-xs text-slate-500">{STATUS_LABELS[r.status]}</div>}
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900">{r.firmName}</div>
                  <div className="text-xs text-slate-500">{r.firmType}</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{r.panMasked}</td>
                <td className="px-3 py-2">{r.signatoryName}</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDateIST(r.submittedAt)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.status === 'pending_accounts' || r.status === 'pending_manager' ? waiting(r) : '—'}</td>
                <td className="px-3 py-2">{responsible(r)}</td>
                <td className="px-3 py-2">{flags(r)}</td>
                {action && <td className="px-3 py-2 text-right">{action(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones */}
      <ul className="space-y-3 lg:hidden">
        {rows.map((r) => (
          <li key={r.id} className="card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link to={linkTo(r)} className="font-semibold text-brand hover:underline">
                  {r.applicationId}
                </Link>
                <div className="truncate text-sm font-medium text-slate-900">{r.firmName}</div>
                <div className="text-xs text-slate-500">
                  {r.firmType} · PAN {r.panMasked}
                </div>
              </div>
              {action?.(r)}
            </div>
            <div className="text-xs text-slate-600">
              {r.signatoryName} · submitted {formatDateIST(r.submittedAt)} · waiting {waiting(r)}
            </div>
            <div className="text-xs text-slate-600">
              {responsibleLabel}: {responsible(r)}
            </div>
            {showStatus && <div className="text-xs text-slate-600">Status: {STATUS_LABELS[r.status]}</div>}
            {flags(r)}
          </li>
        ))}
      </ul>
    </>
  );
}
