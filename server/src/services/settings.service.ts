import type { HolidayInput, HolidayView, SettingsView } from '@fap/shared';
import { AppError } from '../lib/errors';
import { duplicateKeyField } from '../lib/mongo-errors';
import { Holiday } from '../models/Holiday';
import { getSettings } from '../models/Settings';
import { audit } from './audit.service';
import type { Actor } from './users.service';

const SETTING_KEYS = [
  'organisationName',
  'portalName',
  'logoUrl',
  'primaryColor',
  'secondaryColor',
  'supportEmail',
  'supportPhone',
  'agreementRefPrefix',
  'otpExpiryMinutes',
  'otpResendCooldownSeconds',
  'otpMaxAttempts',
  'pendingVerificationRetentionDays',
  'reminderFirstAfterDays',
  'reminderRepeatEveryDays',
  'escalationAfterDays',
  'reminderRunTime',
  'maxDocumentSizeMB',
  'maxPhotoSizeMB',
  'maxRentalSizeMB',
  'sessionTimeoutMinutes',
] as const satisfies readonly (keyof SettingsView)[];

export async function getSettingsView(): Promise<SettingsView> {
  const s = await getSettings();
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, s.get(k) ?? null])) as SettingsView;
}

export async function updateSettings(input: SettingsView, actor: Actor): Promise<SettingsView> {
  const s = await getSettings();
  const changes: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const before = s.get(key) ?? null;
    const after = input[key] ?? null;
    if (before === after) continue;
    // The logo is a large image; record only that it changed.
    changes[key] = key === 'logoUrl' ? 'changed' : { from: before, to: after };
    s.set(key, after);
  }
  if (Object.keys(changes).length > 0) {
    await s.save();
    await audit({ action: 'settings_updated', userId: actor.user._id, role: 'admin', targetType: 'settings', details: { changes }, ip: actor.ip });
  }
  return getSettingsView();
}

const toHolidayView = (h: { _id: { toString(): string }; date: string; name: string }): HolidayView => ({
  id: h._id.toString(),
  date: h.date,
  name: h.name,
});

export async function listHolidays(): Promise<HolidayView[]> {
  const holidays = await Holiday.find().sort({ date: 1 });
  return holidays.map(toHolidayView);
}

export async function addHoliday(input: HolidayInput, actor: Actor): Promise<HolidayView> {
  try {
    const holiday = await Holiday.create(input);
    await audit({ action: 'holiday_added', userId: actor.user._id, role: 'admin', targetType: 'holiday', targetId: holiday._id.toString(), details: input, ip: actor.ip });
    return toHolidayView(holiday);
  } catch (err) {
    if (duplicateKeyField(err)) throw new AppError(409, 'This date is already in the holiday list.', 'duplicate');
    throw err;
  }
}

/** Holidays are configuration, so Admin may remove one added by mistake. The removal is audited. */
export async function removeHoliday(id: string, actor: Actor) {
  const holiday = await Holiday.findByIdAndDelete(id).catch(() => null);
  if (!holiday) throw new AppError(404, 'Holiday not found.', 'not_found');
  await audit({ action: 'holiday_removed', userId: actor.user._id, role: 'admin', targetType: 'holiday', targetId: id, details: { date: holiday.date, name: holiday.name }, ip: actor.ip });
}
