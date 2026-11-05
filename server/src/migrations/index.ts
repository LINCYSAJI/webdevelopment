import type { mongo } from 'mongoose';
import m001 from './001-users-sessions-audit';
import m002 from './002-admin-tools';
import m003 from './003-agreement-pdf';
import m004 from './004-registrations';
import m005 from './005-verification';
import m006 from './006-otp-throttle';
import m007 from './007-review-workflow';
import m008 from './008-last-submitted';
import m009 from './009-manager-agreements';
import m010 from './010-privacy';

export interface Migration {
  id: string;
  up(db: mongo.Db): Promise<void>;
}

// Append new migrations to the end. Never edit or reorder ones already applied.
export const migrations: Migration[] = [m001, m002, m003, m004, m005, m006, m007, m008, m009, m010];
