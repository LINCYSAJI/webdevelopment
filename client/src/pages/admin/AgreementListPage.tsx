import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDateIST, type AgreementStatus, type AgreementVersionView } from '@fap/shared';
import * as adminApi from '../../api/admin';
import { ApiError } from '../../api/client';
import { Alert, Badge, Loading, PageHeader, SecondaryButton } from '../../components/ui';

export const AGREEMENT_STATUS_BADGE: Record<AgreementStatus, { label: string; color: 'green' | 'gray' | 'amber' }> = {
  active: { label: 'Active', color: 'green' },
  draft: { label: 'Draft', color: 'amber' },
  inactive: { label: 'Inactive', color: 'gray' },
};

export function AgreementListPage() {
  const navigate = useNavigate();
  const [versions, setVersions] = useState<AgreementVersionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    adminApi
      .listAgreements()
      .then(setVersions)
      .catch(() => setError('Could not load agreement versions.'));
  }, []);
  useEffect(load, [load]);

  const duplicate = async (v: AgreementVersionView) => {
    try {
      const copy = await adminApi.duplicateAgreement(v.id);
      navigate(`/app/admin/agreement-content/${copy.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not duplicate.');
    }
  };

  const hasActive = versions?.some((v) => v.status === 'active');

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Agreement Content"
        description="The active version is shown on the registration page. Published versions are locked; duplicate one to make changes."
        actions={
          <>
            <Link to="/app/admin/agreement-content/new?format=pdf" className="btn-primary">
              + Upload PDF agreement
            </Link>
            <Link
              to="/app/admin/agreement-content/new?format=text"
              className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Type an agreement
            </Link>
          </>
        }
      />

      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      {versions && !hasActive && (
        <div className="mb-4">
          <Alert tone="warning">
            <strong>Registration is closed.</strong> No agreement version is active, so franchise partners cannot register.
            Publish a version to open registration.
          </Alert>
        </div>
      )}

      {!versions ? (
        !error && <Loading />
      ) : versions.length === 0 ? (
        <div className="card text-center text-sm text-slate-600">No agreement versions yet. Create the first draft to get started.</div>
      ) : (
        <ul className="space-y-3">
          {versions.map((v) => (
            <li key={v.id} className="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">Version {v.versionNumber}</span>
                  <Badge color={AGREEMENT_STATUS_BADGE[v.status].color}>{AGREEMENT_STATUS_BADGE[v.status].label}</Badge>
                  <Badge color="blue">{v.format === 'pdf' ? 'PDF' : 'Typed text'}</Badge>
                </div>
                <div className="mt-0.5 break-words text-sm text-slate-700">
                  {v.title}
                  {v.format === 'pdf' && (
                    <span className="text-slate-500"> · {v.pdf ? `${v.pdf.fileName} (${v.pdf.pageCount} pages)` : 'no PDF uploaded yet'}</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Created {formatDateIST(v.createdAt)}
                  {v.createdBy ? ` by ${v.createdBy}` : ''}
                  {v.publishedAt ? ` · Published ${formatDateIST(v.publishedAt)}${v.publishedBy ? ` by ${v.publishedBy}` : ''}` : ''}
                  {` · ${v.acceptanceCount} acceptance${v.acceptanceCount === 1 ? '' : 's'}`}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link to={`/app/admin/agreement-content/${v.id}`} className="btn-primary px-3 py-1.5 text-xs">
                  {v.status === 'draft' ? 'Edit' : 'View'}
                </Link>
                <SecondaryButton className="px-3 py-1.5 text-xs" onClick={() => duplicate(v)}>
                  Duplicate as new draft
                </SecondaryButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
