import { PASSWORD_RULES } from '@fap/shared';

/** Live checklist of the password strength rules (PRD P4). */
export function PasswordRules({ password }: { password: string }) {
  return (
    <ul className="grid gap-1 text-xs sm:grid-cols-2" aria-label="Password rules">
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(password);
        return (
          <li key={rule.label} className={ok ? 'text-green-700' : 'text-slate-500'}>
            <span aria-hidden>{ok ? '✓' : '○'}</span> {rule.label}
            <span className="sr-only">{ok ? ' (met)' : ' (not met)'}</span>
          </li>
        );
      })}
    </ul>
  );
}
