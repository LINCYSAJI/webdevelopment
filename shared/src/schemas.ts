import { z } from 'zod';
import type { Role } from './constants';

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email, mobile number or username'),
  password: z.string().min(1, 'Enter your password'),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** The user object the API returns to the browser. Never includes password data. */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  mobile: string | null;
  username: string | null;
  role: Role;
}

export interface Branding {
  organisationName: string;
  portalName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  supportEmail: string | null;
  supportPhone: string | null;
}
