import type { ClientSession, FilterQuery, Types } from 'mongoose';
import type { AuditLogView, Paginated, Role } from '@fap/shared';
import { AuditLog } from '../models/AuditLog';
import { User } from '../models/User';

export interface AuditEntry {
  action: string;
  userId?: Types.ObjectId | string | null;
  role?: Role | null;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  ip?: string;
}

/**
 * Appends an audit entry. Pass the transaction's session when the entry belongs to a
 * multi-document change, so it is saved together with that change or not at all (CLAUDE.md rule 3).
 */
export async function audit(entry: AuditEntry, session?: ClientSession): Promise<void> {
  await AuditLog.create([{ ...entry, at: new Date() }], session ? { session } : {});
}

export interface AuditQuery {
  page: number;
  pageSize: number;
  action?: string;
  from?: string; // YYYY-MM-DD, IST
  to?: string;
  search?: string;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function listAuditLogs(q: AuditQuery): Promise<Paginated<AuditLogView>> {
  const filter: FilterQuery<typeof AuditLog> = {};
  if (q.action) filter.action = q.action;
  if (q.from || q.to) {
    filter.at = {
      ...(q.from ? { $gte: new Date(`${q.from}T00:00:00+05:30`) } : {}),
      ...(q.to ? { $lte: new Date(`${q.to}T23:59:59.999+05:30`) } : {}),
    };
  }
  if (q.search) {
    const re = new RegExp(escapeRegex(q.search.trim()), 'i');
    const users = await User.find({ $or: [{ name: re }, { email: re }, { username: re }] }, { _id: 1 }).limit(50);
    filter.$or = [{ userId: { $in: users.map((u) => u._id) } }, { targetId: q.search.trim() }, { ip: re }];
  }

  const [total, rows] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter)
      .sort({ at: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
  ]);

  const users = await User.find({ _id: { $in: rows.map((r) => r.userId).filter(Boolean) } }, { name: 1, email: 1 });
  const byId = new Map(users.map((u) => [u._id.toString(), u]));

  return {
    page: q.page,
    pageSize: q.pageSize,
    total,
    items: rows.map((r) => {
      const u = r.userId ? byId.get(r.userId.toString()) : undefined;
      return {
        id: r._id.toString(),
        at: r.at.toISOString(),
        user: u ? { id: u._id.toString(), name: u.name, email: u.email } : null,
        role: (r.role as Role) ?? null,
        action: r.action,
        targetType: r.targetType ?? null,
        targetId: r.targetId ?? null,
        details: (r.details as Record<string, unknown>) ?? null,
        ip: r.ip ?? null,
      };
    }),
  };
}

export async function listAuditActions(): Promise<string[]> {
  const actions = await AuditLog.distinct('action');
  return (actions as string[]).sort();
}
