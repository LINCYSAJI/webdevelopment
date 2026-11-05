import { useState } from 'react';
import { FIRM_TYPES } from '@fap/shared';

interface ReviewFiltersProps {
  params: URLSearchParams;
  /** Updates the address-bar filters (null removes one). */
  set: (changes: Record<string, string | null>) => void;
  /** Which tick-box filters to offer. */
  checks?: ('overdue' | 'flagged' | 'resubmitted')[];
}

const CHECK_LABELS = { overdue: 'Overdue only', flagged: 'Flagged only', resubmitted: 'Resubmitted only' } as const;

/** Search and filters shared by the review lists (PRD A2, M2, M4). */
export function ReviewFilters({ params, set, checks = ['overdue', 'flagged', 'resubmitted'] }: ReviewFiltersProps) {
  const [search, setSearch] = useState(params.get('search') ?? '');
  return (
    <form
      className="card mb-4 grid gap-3 md:grid-cols-[2fr_1fr_1fr_1fr]"
      onSubmit={(e) => {
        e.preventDefault();
        set({ search: search.trim() || null });
      }}
    >
      <div>
        <label htmlFor="search" className="label">
          Search
        </label>
        <input
          id="search"
          className="input"
          placeholder="Application ID, reference, firm, PAN, GST, name, email or mobile"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onBlur={() => set({ search: search.trim() || null })}
        />
      </div>
      <div>
        <label htmlFor="firmType" className="label">
          Firm Type
        </label>
        <select id="firmType" className="input" value={params.get('firmType') ?? ''} onChange={(e) => set({ firmType: e.target.value || null })}>
          <option value="">All</option>
          {FIRM_TYPES.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="from" className="label">
          Submitted from
        </label>
        <input id="from" type="date" className="input" value={params.get('from') ?? ''} onChange={(e) => set({ from: e.target.value || null })} />
      </div>
      <div>
        <label htmlFor="to" className="label">
          Submitted to
        </label>
        <input id="to" type="date" className="input" value={params.get('to') ?? ''} onChange={(e) => set({ to: e.target.value || null })} />
      </div>
      {checks.length > 0 && (
        <div className="flex flex-wrap gap-4 md:col-span-4">
          {checks.map((key) => (
            <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4" checked={params.get(key) === '1'} onChange={(e) => set({ [key]: e.target.checked ? '1' : null })} />
              {CHECK_LABELS[key]}
            </label>
          ))}
        </div>
      )}
    </form>
  );
}
