import { Link } from 'react-router-dom';

/** Placeholder for a screen that is scheduled in a later build step. */
export function ComingSoonPage({ title, step, publicPage }: { title: string; step?: number; publicPage?: boolean }) {
  const content = (
    <div className="card mx-auto max-w-lg text-center">
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">
        This screen is planned{step ? ` for build step ${step}` : ''} and is not available yet.
      </p>
      <Link to={publicPage ? '/login' : '/app'} className="btn-primary mt-5">
        {publicPage ? 'Back to login' : 'Back to dashboard'}
      </Link>
    </div>
  );
  return publicPage ? <div className="flex min-h-screen items-center px-4">{content}</div> : content;
}
