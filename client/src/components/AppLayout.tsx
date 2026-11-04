import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ROLE_LABELS } from '@fap/shared';
import { useAuth } from '../auth/AuthContext';
import { useBranding } from '../branding/BrandingContext';
import { NAVIGATION } from '../navigation';
import { BrandMark } from './BrandMark';

export function AppLayout() {
  const { user, logout } = useAuth();
  const { portalName } = useBranding();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!user) return null;
  const items = NAVIGATION[user.role];

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const menu = (
    <nav className="flex flex-1 flex-col gap-1 p-3">
      {items.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === '/app'}
          onClick={() => setMenuOpen(false)}
          className={({ isActive }) =>
            `rounded-md px-3 py-2 text-sm font-medium ${
              isActive ? 'bg-brand text-white' : 'text-slate-700 hover:bg-slate-100'
            }`
          }
        >
          {item.label}
        </NavLink>
      ))}
      <button
        onClick={handleLogout}
        className="mt-auto rounded-md px-3 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50"
      >
        Logout
      </button>
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <button
          className="rounded-md p-2 text-slate-600 hover:bg-slate-100 md:hidden"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path d="M3 5h14v2H3zM3 9h14v2H3zM3 13h14v2H3z" />
          </svg>
        </button>
        <BrandMark size={32} />
        <span className="truncate font-semibold text-slate-900">{portalName}</span>
        <div className="ml-auto text-right">
          <div className="text-sm font-medium text-slate-900">{user.name}</div>
          <div className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">{menu}</aside>

        {menuOpen && (
          <div className="fixed inset-0 z-30 md:hidden" role="dialog" aria-modal>
            <div className="absolute inset-0 bg-black/30" onClick={() => setMenuOpen(false)} />
            <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-white shadow-xl">{menu}</aside>
          </div>
        )}

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
