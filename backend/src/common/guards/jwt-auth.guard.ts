import { Injectable, UnauthorizedException, ForbiddenException, SetMetadata } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../../auth/auth.service.js';
import type { AuthenticatedRequest } from '../request.js';

export const PUBLIC_KEY = 'isPublic';
export const PENDING_KEY = 'allowPending';
export const ROLES_KEY = 'roles';
export const EVENT_PERMISSION_KEY = 'eventPermission';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const AllowPending = () => SetMetadata(PENDING_KEY, true);
export const RequirePermission = (permission: string) => SetMetadata(EVENT_PERMISSION_KEY, permission);

export const ROLE_PERMISSIONS: Record<string, Set<string>> = {
  super_admin: new Set(['events.create','events.view','events.manage','events.restore','access.manage','attendees.manage','tickets.manage','reports.view','exports.create','checkin.perform','users.manage','system.manage']),
  event_manager: new Set(['events.view','events.manage','access.manage','attendees.manage','tickets.manage','reports.view','exports.create']),
  ticket_manager: new Set(['events.view','attendees.manage','tickets.manage','exports.create']),
  checkin_supervisor: new Set(['events.view','reports.view']),
  scanner: new Set(['checkin.perform']),
};
export function hasPermission(role: string, permission: string) { return ROLE_PERMISSIONS[role]?.has(permission) ?? false; }

/** Compatibility name only: opaque DB-backed sessions replace unrevocable JWTs. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Authentication required.');
    const identity = await this.auth.authenticate(header.slice(7), !!this.reflector.getAllAndOverride<boolean>(PENDING_KEY, targets));
    Object.assign(req, identity);
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, targets);
    const permission = this.reflector.getAllAndOverride<string>(EVENT_PERMISSION_KEY, targets);
    if ((roles && !roles.includes(identity.orgRole)) || (permission && !hasPermission(identity.orgRole, permission))) throw new ForbiddenException('Permission denied.');
    return true;
  }
}
