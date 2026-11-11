import type { Request } from 'express';
export type { Response } from 'express';

export type AuthenticatedRequest = Request & {
  user: { id: number; username: string; displayName: string };
  orgRole: string;
  orgId: number;
  sessionHash: string;
  requiresFactor: boolean;
  requiresPasswordChange: boolean;
  enrolled: boolean;
};
