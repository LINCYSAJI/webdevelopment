import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AGREEMENT_PDF_MAX_BYTES,
  SAMPLE_MERGE_VALUES,
  agreementDraftSchema,
  formatDateTimeIST,
  renderAgreement,
  type AgreementFormat,
  type AgreementVersionView,
} from '@fap/shared';
import * as adminApi from '../../api/admin';
import { ApiError } from '../../api/client';
import { useBranding } from '../../branding/BrandingContext';
import { PdfViewer } from '../../components/PdfViewer';
import { RichTextEditor } from '../../components/RichTextEditor';
import { Alert, Badge, Loading, Modal, SafeHtml, SecondaryButton } from '../../components/ui';
import { AGREEMENT_STATUS_BADGE } from './AgreementListPage';

const STARTER_CONTENT =
  '<h2>Franchise Agreement</h2><p>This Franchise Agreement is made between {{organisation_name}} and {{firm_name}}, a {{firm_type}} holding PAN {{pan_number}}, represented by {{signatory_name}} ({{signatory_capacity}}).</p><h3>1. Franchise model</h3><p>The franchisee will operate under the {{franchise_model}} model.</p><h3>2. Terms</h3><ol><li><p>Add the agreement terms here.</p></li></ol>';

type Notice = { tone: 'success' | 'error' | 'warning'; text: string } | null;

const formatFileSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function AgreementEditorPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { organisationName } = useBranding();
  const fileInput = useRef<HTMLInputElement>(null);

  const [version, setVersion] = useState<AgreementVersionView | null>(null);
  const [title, setTitle] = useState('Franchise Agreement');
  const [content, setContent] = useState(STARTER_CONTENT);
  const [saved, setSaved] = useState({ title: '', content: '' });
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'publish' | 'deactivate' | null>(null);
  const [loading, setLoading] = useState(!isNew);

  useEffect(() => {
    // Skip reloading when we just created this draft ourselves (we already have it).
    if (isNew || version?.id === id) return;
    setLoading(true);
    adminApi
      .getAgreement(id)
      .then((v) => {
        setVersion(v);
        setTitle(v.title);
        setContent(v.content);
        setSaved({ title: v.title, content: v.content });
        setTab(v.status === 'draft' ? 'edit' : 'preview');
      })
      .catch(() => setNotice({ tone: 'error', text: 'This agreement version could not be found.' }))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  if (loading) return <Loading />;

  // New drafts are PDF uploads unless Admin chose "Type an agreement".
  const format: AgreementFormat = version?.format ?? (searchParams.get('format') === 'text' ? 'text' : 'pdf');
  const isPdf = format === 'pdf';
  const editable = isNew || version?.status === 'draft';
  const dirty = editable && (title !== saved.title || (!isPdf && content !== saved.content));
  const preview = renderAgreement(content, { ...SAMPLE_MERGE_VALUES, organisation_name: organisationName });
  const missingPdf = isPdf && !version?.pdf;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof ApiError ? err.message : 'Something went wrong. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  /** Saves the draft and returns its id. */
  const saveDraft = async (): Promise<string | null> => {
    const parsed = agreementDraftSchema.safeParse({ title, content: isPdf ? '' : content, format });
    if (!parsed.success) {
      setNotice({ tone: 'error', text: parsed.error.issues[0].message });
      return null;
    }
    const v = isNew ? await adminApi.createAgreement(parsed.data) : await adminApi.updateAgreement(id, parsed.data);
    setVersion(v);
    setTitle(v.title);
    setContent(v.content);
    setSaved({ title: v.title, content: v.content });
    if (isNew) navigate(`/app/admin/agreement-content/${v.id}`, { replace: true });
    return v.id;
  };

  const handleSave = () =>
    run(async () => {
      if (await saveDraft()) setNotice({ tone: 'success', text: 'Draft saved. It is not visible to applicants until you publish it.' });
    });

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      setNotice({ tone: 'error', text: 'Please choose a PDF file.' });
      return;
    }
    if (file.size > AGREEMENT_PDF_MAX_BYTES) {
      setNotice({ tone: 'error', text: `This file is ${formatFileSize(file.size)}. The PDF must be 10 MB or smaller.` });
      return;
    }
    void run(async () => {
      // A brand-new draft is saved first so the PDF has somewhere to belong.
      const versionId = isNew || dirty ? await saveDraft() : version!.id;
      if (!versionId) return;
      const v = await adminApi.uploadAgreementPdf(versionId, file);
      setVersion(v);
      setNotice({ tone: 'success', text: `"${v.pdf?.fileName}" uploaded and saved as a draft. Check the preview below, then publish when ready.` });
    });
  };

  const handlePublish = () =>
    run(async () => {
      setConfirm(null);
      const versionId = editable ? await saveDraft() : version!.id;
      if (!versionId) return;
      const v = await adminApi.activateAgreement(versionId);
      setVersion(v);
      setTab('preview');
      setNotice({ tone: 'success', text: `Version ${v.versionNumber} is now active and shown on the registration page.` });
    });

  const handleDeactivate = () =>
    run(async () => {
      setConfirm(null);
      const v = await adminApi.deactivateAgreement(version!.id);
      setVersion(v);
      setNotice({ tone: 'warning', text: 'This version is now inactive. Registration is closed until another version is published.' });
    });

  const handleDuplicate = () =>
    run(async () => {
      const copy = await adminApi.duplicateAgreement(version!.id);
      navigate(`/app/admin/agreement-content/${copy.id}`);
    });

  const status = version?.status ?? 'draft';

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/app/admin/agreement-content" className="text-sm font-medium text-brand hover:underline">
        ← All agreement versions
      </Link>

      <div className="mb-4 mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">
              {version ? `Version ${version.versionNumber}` : isPdf ? 'New PDF agreement' : 'New agreement draft'}
            </h1>
            <Badge color={AGREEMENT_STATUS_BADGE[status].color}>{AGREEMENT_STATUS_BADGE[status].label}</Badge>
            <Badge color="blue">{isPdf ? 'PDF' : 'Typed text'}</Badge>
            {dirty && <Badge color="blue">Unsaved changes</Badge>}
          </div>
          {version && (
            <p className="mt-1 text-xs text-slate-500">
              Last saved {formatDateTimeIST(version.updatedAt)}
              {version.publishedAt ? ` · First published ${formatDateTimeIST(version.publishedAt)}` : ''}
              {` · ${version.acceptanceCount} acceptance(s)`}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {editable && (
            <SecondaryButton onClick={handleSave} disabled={busy || (!dirty && !isNew)}>
              Save draft
            </SecondaryButton>
          )}
          {status !== 'active' && (
            <button
              className="btn-primary"
              disabled={busy || missingPdf}
              title={missingPdf ? 'Upload the agreement PDF first' : undefined}
              onClick={() => setConfirm('publish')}
            >
              {status === 'draft' ? 'Publish' : 'Activate'}
            </button>
          )}
          {status === 'active' && (
            <SecondaryButton className="text-red-700" disabled={busy} onClick={() => setConfirm('deactivate')}>
              Deactivate
            </SecondaryButton>
          )}
          {!editable && version && (
            <SecondaryButton disabled={busy} onClick={handleDuplicate}>
              Duplicate as new draft
            </SecondaryButton>
          )}
        </div>
      </div>

      {notice && <div className="mb-4"><Alert tone={notice.tone}>{notice.text}</Alert></div>}
      {!editable && (
        <div className="mb-4">
          <Alert tone="info">
            Published versions are locked so every applicant's accepted terms stay exactly as they were. To make changes, use
            "Duplicate as new draft".
          </Alert>
        </div>
      )}

      {editable && (
        <div className="mb-4">
          <label htmlFor="agreement-title" className="label">Agreement title</label>
          <input id="agreement-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
      )}

      {isPdf ? (
        <>
          <div className="card mb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="font-semibold text-slate-900">Agreement PDF</h2>
                {version?.pdf ? (
                  <p className="mt-1 break-words text-sm text-slate-600">
                    <span className="font-medium text-slate-800">{version.pdf.fileName}</span> · {version.pdf.pageCount} page
                    {version.pdf.pageCount === 1 ? '' : 's'} · {formatFileSize(version.pdf.size)} · uploaded{' '}
                    {formatDateTimeIST(version.pdf.uploadedAt)}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-slate-600">No PDF uploaded yet. PDF only, up to 10 MB, without a password.</p>
                )}
              </div>
              {editable && (
                <>
                  <input ref={fileInput} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleFile} />
                  <button className="btn-primary shrink-0" disabled={busy} onClick={() => fileInput.current?.click()}>
                    {busy ? 'Please wait…' : version?.pdf ? 'Replace PDF' : 'Upload PDF'}
                  </button>
                </>
              )}
            </div>
          </div>

          {version?.pdf && (
            <div className="card">
              <h2 className="mb-3 font-semibold text-slate-900">Preview</h2>
              <PdfViewer
                url={`${adminApi.agreementPdfUrl(version.id)}?v=${encodeURIComponent(version.pdf.uploadedAt)}`}
                label={title}
              />
              <p className="mt-3 text-xs text-slate-500">
                Applicants see exactly this document on the registration page, with the acceptance checkbox below it.
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mb-3 flex gap-1 border-b border-slate-200" role="tablist">
            {editable && (
              <button role="tab" aria-selected={tab === 'edit'} onClick={() => setTab('edit')} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === 'edit' ? 'border-brand text-brand' : 'border-transparent text-slate-600'}`}>
                Edit
              </button>
            )}
            <button role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === 'preview' ? 'border-brand text-brand' : 'border-transparent text-slate-600'}`}>
              Preview with sample details
            </button>
          </div>

          {tab === 'edit' && editable ? (
            <>
              <RichTextEditor value={content} onChange={setContent} />
              <p className="mt-2 text-xs text-slate-500">
                Use "Insert merge field" to add details such as {'{{firm_name}}'}. They are filled in automatically with each applicant's details.
              </p>
            </>
          ) : (
            <div className="card">
              <h2 className="mb-4 border-b border-slate-200 pb-3 text-center text-lg font-bold">{title}</h2>
              <SafeHtml html={preview} className="agreement-content" />
              <p className="mt-6 border-t border-slate-200 pt-3 text-center text-xs text-slate-500">
                Preview using sample details. Applicants see their own details; the PDF uses the approved details.
              </p>
            </div>
          )}
        </>
      )}

      {confirm === 'publish' && (
        <Modal
          title={status === 'draft' ? 'Publish this agreement?' : 'Activate this version?'}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <SecondaryButton onClick={() => setConfirm(null)}>Cancel</SecondaryButton>
              <button className="btn-primary" onClick={handlePublish} disabled={busy}>
                {status === 'draft' ? 'Publish now' : 'Activate'}
              </button>
            </>
          }
        >
          <div className="space-y-2 text-sm text-slate-700">
            <p>This version will immediately appear on the registration page for new applicants. Any currently active version becomes inactive.</p>
            {status === 'draft' && <p>After publishing, the {isPdf ? 'PDF' : 'text'} is locked and cannot be changed.</p>}
            <p>Applicants who already registered keep the version they accepted.</p>
          </div>
        </Modal>
      )}

      {confirm === 'deactivate' && (
        <Modal
          title="Deactivate this version?"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <SecondaryButton onClick={() => setConfirm(null)}>Cancel</SecondaryButton>
              <button className="btn-danger" onClick={handleDeactivate} disabled={busy}>
                Deactivate
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-700">
            With no active version, <strong>registration closes</strong> and new franchise partners cannot apply until you publish or activate another version.
          </p>
        </Modal>
      )}
    </div>
  );
}
