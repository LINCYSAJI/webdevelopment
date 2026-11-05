import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatDateIST, formatDateTimeIST, internalUserSchema, type AdminUserView, type InternalUserInput, type ManagedRole } from '@fap/shared';
import * as adminApi from '../../api/admin';
import { ApiError } from '../../api/client';
import { Alert, Badge, Field, Loading, Modal, PageHeader, SecondaryButton } from '../../components/ui';

const ROLE_TEXT: Record<ManagedRole, { title: string; singular: string; description: string }> = {
  accounts: {
    title: 'Accounts Users',
    singular: 'Accounts user',
    description: 'First-level reviewers. New users receive an email with a link to set their own password.',
  },
  manager: {
    title: 'Manager Users',
    singular: 'Manager',
    description: 'Final approvers who send agreements to franchisees. New users receive an email to set their password.',
  },
};

const EMPTY_FORM: InternalUserInput = { name: '', email: '', username: '', mobile: '' };

type Notice = { tone: 'success' | 'error' | 'warning'; text: string } | null;

export function UsersPage({ role }: { role: ManagedRole }) {
  const text = ROLE_TEXT[role];
  const [users, setUsers] = useState<AdminUserView[] | null>(null);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<AdminUserView | 'new' | null>(null);
  const [confirming, setConfirming] = useState<AdminUserView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [handover, setHandover] = useState<{ user: AdminUserView; count: number } | null>(null);

  const load = useCallback(() => {
    adminApi
      .listUsers(role)
      .then(setUsers)
      .catch((err) => setNotice({ tone: 'error', text: err instanceof ApiError ? err.message : 'Could not load users.' }));
  }, [role]);

  useEffect(() => {
    setUsers(null);
    setNotice(null);
    load();
  }, [load]);

  const q = search.trim().toLowerCase();
  const visible = (users ?? []).filter(
    (u) => !q || [u.name, u.email, u.username ?? '', u.mobile ?? ''].some((v) => v.toLowerCase().includes(q)),
  );

  const toggleActive = async (u: AdminUserView) => {
    setConfirming(null);
    setBusyId(u.id);
    try {
      await adminApi.setUserActive(role, u.id, !u.isActive);
      setNotice({ tone: 'success', text: `${u.name} has been ${u.isActive ? 'deactivated and logged out' : 'reactivated'}.` });
      load();
    } catch (err) {
      // An Accounts user still reviewing applications must hand them over first (PRD AD8).
      if (err instanceof ApiError && err.code === 'has_assignments') {
        setHandover({ user: u, count: Number(err.details.assignedCount) || 0 });
      } else {
        setNotice({ tone: 'error', text: err instanceof ApiError ? err.message : 'Action failed.' });
      }
    } finally {
      setBusyId(null);
    }
  };

  const sendLink = async (u: AdminUserView) => {
    setBusyId(u.id);
    try {
      const sent = await adminApi.sendPasswordLink(role, u.id);
      setNotice(
        sent
          ? { tone: 'success', text: `A ${u.passwordSet ? 'password reset' : 'set password'} link has been emailed to ${u.email}.` }
          : { tone: 'warning', text: 'The email could not be sent. Please try again later.' },
      );
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof ApiError ? err.message : 'Action failed.' });
    } finally {
      setBusyId(null);
    }
  };

  const actions = (u: AdminUserView) => (
    <div className="flex flex-wrap gap-2">
      <SecondaryButton className="px-3 py-1.5 text-xs" onClick={() => setEditing(u)}>
        Edit
      </SecondaryButton>
      {u.isActive && (
        <SecondaryButton className="px-3 py-1.5 text-xs" disabled={busyId === u.id} onClick={() => sendLink(u)}>
          {u.passwordSet ? 'Send password reset' : 'Resend invitation'}
        </SecondaryButton>
      )}
      <SecondaryButton
        className={`px-3 py-1.5 text-xs ${u.isActive ? 'text-red-700' : 'text-green-700'}`}
        disabled={busyId === u.id}
        onClick={() => (u.isActive ? setConfirming(u) : toggleActive(u))}
      >
        {u.isActive ? 'Deactivate' : 'Reactivate'}
      </SecondaryButton>
    </div>
  );

  const status = (u: AdminUserView) =>
    !u.isActive ? <Badge color="gray">Inactive</Badge> : u.passwordSet ? <Badge color="green">Active</Badge> : <Badge color="amber">Invitation sent</Badge>;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={text.title}
        description={text.description}
        actions={
          <button className="btn-primary" onClick={() => setEditing('new')}>
            + Create {text.singular}
          </button>
        }
      />

      {notice && (
        <div className="mb-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      <div className="mb-4 max-w-sm">
        <input className="input" placeholder="Search name, email, username or mobile" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users" />
      </div>

      {!users ? (
        <Loading />
      ) : visible.length === 0 ? (
        <div className="card text-center text-sm text-slate-600">{users.length === 0 ? `No ${text.title.toLowerCase()} yet.` : 'No users match your search.'}</div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden overflow-x-auto p-0 lg:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email / Username</th>
                  <th className="px-4 py-3">Mobile</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Last login</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((u) => (
                  <tr key={u.id} className={u.isActive ? '' : 'text-slate-400'}>
                    <td className="px-4 py-3 font-medium">{u.name}</td>
                    <td className="px-4 py-3">
                      <div>{u.email}</div>
                      <div className="text-xs text-slate-500">{u.username}</div>
                    </td>
                    <td className="px-4 py-3">{u.mobile ?? '—'}</td>
                    <td className="px-4 py-3">{status(u)}</td>
                    <td className="px-4 py-3">{formatDateIST(u.createdAt)}</td>
                    <td className="px-4 py-3">{formatDateTimeIST(u.lastLoginAt)}</td>
                    <td className="px-4 py-3">{actions(u)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile and tablet cards */}
          <ul className="space-y-3 lg:hidden">
            {visible.map((u) => (
              <li key={u.id} className="card space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">{u.name}</div>
                    <div className="text-sm text-slate-600">{u.email}</div>
                    <div className="text-xs text-slate-500">
                      {u.username} · {u.mobile ?? 'No mobile'}
                    </div>
                  </div>
                  {status(u)}
                </div>
                <div className="text-xs text-slate-500">Last login: {formatDateTimeIST(u.lastLoginAt)}</div>
                {actions(u)}
              </li>
            ))}
          </ul>
        </>
      )}

      {editing && (
        <UserFormModal
          role={role}
          user={editing === 'new' ? null : editing}
          singular={text.singular}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice(message);
            load();
          }}
        />
      )}

      {handover && (
        <HandoverModal
          user={handover.user}
          count={handover.count}
          others={(users ?? []).filter((x) => x.isActive && x.id !== handover.user.id)}
          onClose={() => setHandover(null)}
          onDone={(message) => {
            setHandover(null);
            setNotice({ tone: 'success', text: message });
            load();
          }}
        />
      )}

      {confirming && (
        <Modal
          title={`Deactivate ${confirming.name}?`}
          onClose={() => setConfirming(null)}
          footer={
            <>
              <SecondaryButton onClick={() => setConfirming(null)}>Cancel</SecondaryButton>
              <button className="btn-danger" onClick={() => toggleActive(confirming)}>
                Deactivate
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-700">
            They will be logged out immediately and will not be able to log in until reactivated. Their history is kept.
          </p>
        </Modal>
      )}
    </div>
  );
}

function UserFormModal({
  role,
  user,
  singular,
  onClose,
  onSaved,
}: {
  role: ManagedRole;
  user: AdminUserView | null;
  singular: string;
  onClose: () => void;
  onSaved: (notice: Notice) => void;
}) {
  const [form, setForm] = useState<InternalUserInput>(
    user ? { name: user.name, email: user.email, username: user.username ?? '', mobile: user.mobile ?? '' } : EMPTY_FORM,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof InternalUserInput) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = internalUserSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (user) {
        await adminApi.updateUser(role, user.id, form);
        onSaved({ tone: 'success', text: `${form.name}'s details have been updated.` });
      } else {
        const { emailSent } = await adminApi.createUser(role, form);
        onSaved(
          emailSent
            ? { tone: 'success', text: `${form.name} has been created. An email with a link to set their password was sent to ${parsed.data.email}.` }
            : { tone: 'warning', text: `${form.name} has been created, but the invitation email could not be sent. Use "Resend invitation".` },
        );
      }
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, v[0]])));
      }
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={user ? `Edit ${user.name}` : `Create ${singular}`}
      onClose={onClose}
      footer={
        <>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <button type="submit" form="user-form" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : user ? 'Save changes' : 'Create and send invitation'}
          </button>
        </>
      }
    >
      <form id="user-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Full name" required error={errors.name}>
          {(p) => <input {...p} className="input" value={form.name} onChange={set('name')} />}
        </Field>
        <Field label="Email" required error={errors.email} hint="They log in with this email and receive notifications here.">
          {(p) => <input {...p} type="email" className="input" value={form.email} onChange={set('email')} />}
        </Field>
        <Field label="Username" required error={errors.username} hint="Can also be used to log in.">
          {(p) => <input {...p} className="input" value={form.username} onChange={set('username')} />}
        </Field>
        <Field label="Mobile number" error={errors.mobile} hint="Optional. 10-digit Indian mobile number.">
          {(p) => <input {...p} inputMode="numeric" maxLength={10} className="input" value={form.mobile} onChange={set('mobile')} />}
        </Field>
        <p className="text-xs text-slate-500">Role: {singular} (fixed for this screen).</p>
      </form>
    </Modal>
  );
}

/** PRD AD8: move an Accounts user's applications to someone else (or Unassigned), then deactivate them. */
function HandoverModal({
  user,
  count,
  others,
  onClose,
  onDone,
}: {
  user: AdminUserView;
  count: number;
  others: AdminUserView[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [toUserId, setToUserId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const moved = await adminApi.moveAssignments(user.id, { toUserId: toUserId || null, note });
      await adminApi.setUserActive('accounts', user.id, false);
      const target = others.find((o) => o.id === toUserId)?.name ?? 'the Unassigned queue';
      onDone(`${moved} application${moved === 1 ? '' : 's'} moved to ${target}. ${user.name} has been deactivated and logged out.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Hand over ${user.name}'s applications`}
      onClose={onClose}
      footer={
        <>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <button className="btn-danger" form="handover-form" type="submit" disabled={busy}>
            {busy ? 'Moving…' : 'Move and deactivate'}
          </button>
        </>
      }
    >
      <form id="handover-form" onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-700">
          {user.name} is reviewing <strong>{count}</strong> application{count === 1 ? '' : 's'}. Choose who should take {count === 1 ? 'it' : 'them'} over before they are deactivated.
        </p>
        <div>
          <label htmlFor="handover-to" className="label">Move to</label>
          <select id="handover-to" className="input" value={toUserId} onChange={(e) => setToUserId(e.target.value)}>
            <option value="">Unassigned queue (any Accounts user can pick up)</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="handover-note" className="label">Note (optional)</label>
          <textarea id="handover-note" className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">Included in the email to the new reviewer and in the log.</p>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
      </form>
    </Modal>
  );
}
