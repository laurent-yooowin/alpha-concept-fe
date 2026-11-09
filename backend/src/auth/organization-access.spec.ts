import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '../user/user.entity';
import { UserController } from '../user/user.controller';
import { CurrentOrganizationController } from '../organizations/current-organization.controller';
import { AuthService } from './auth.service';
import { assertOrganizationAccess, pendingLegalValidation } from './organization-access';
import { assertPendingLegalRoute } from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

const activeOrg = { id: 'org-a', slug: 'alpha', name: 'Alpha', isActive: true, legalValidationStatus: 'termine' };
const pendingOrg = { ...activeOrg, legalValidationStatus: 'en_cours' };
const inactiveOrg = { ...activeOrg, isActive: false };
const admin = { id: 'admin-a', email: 'admin@example.test', password: 'hash', isActive: true, role: UserRole.ADMIN, organizationId: 'org-a' };
const coordinator = { ...admin, id: 'user-a', role: UserRole.USER };

test('organization access requires an active organization and limits pending validation to admins', () => {
  assert.equal(assertOrganizationAccess(admin as any, activeOrg as any), false);
  assert.equal(assertOrganizationAccess(admin as any, pendingOrg as any), true);
  assert.throws(() => assertOrganizationAccess(coordinator as any, pendingOrg as any), UnauthorizedException);
  assert.throws(() => assertOrganizationAccess(admin as any, inactiveOrg as any), UnauthorizedException);
  assert.throws(() => assertOrganizationAccess(admin as any, null), UnauthorizedException);
  assert.equal(assertOrganizationAccess({ role: UserRole.HYPER_ADMIN, organizationId: null } as any, null), false);
});

test('login checks actual organization even without a portal slug', async () => {
  const previousPortalMode = process.env.STRICT_LOGIN_PORTAL;
  process.env.STRICT_LOGIN_PORTAL = 'false';
  try {
    let organization = activeOrg;
    let signed = 0;
    const service = new AuthService(
      { findByEmail: async () => admin, validatePassword: async () => true } as any,
      { sign: () => { signed++; return 'token'; } } as any,
      {} as any,
      { findOne: async ({ where }: any) => where.id === 'org-a' || where.slug === 'alpha' ? organization : null } as any,
    );
    const credentials = { email: admin.email, password: 'secret' };
    assert.equal((await service.login(credentials)).access_token, 'token');
    organization = inactiveOrg;
    await assert.rejects(() => service.login(credentials), UnauthorizedException);
    await assert.rejects(() => service.login({ ...credentials, organizationSlug: 'alpha' }), UnauthorizedException);
    assert.equal(signed, 1);
    organization = pendingOrg;
    assert.equal((await service.login(credentials)).access_token, 'token');
    assert.equal(signed, 2);
  } finally {
    if (previousPortalMode === undefined) delete process.env.STRICT_LOGIN_PORTAL;
    else process.env.STRICT_LOGIN_PORTAL = previousPortalMode;
  }
});

test('coordinator cannot log in while legal validation is pending', async () => {
  const previousPortalMode = process.env.STRICT_LOGIN_PORTAL;
  process.env.STRICT_LOGIN_PORTAL = 'false';
  try {
    const service = new AuthService(
      { findByEmail: async () => coordinator, validatePassword: async () => true } as any,
      { sign: () => { throw new Error('JWT must not be signed'); } } as any,
      {} as any,
      { findOne: async () => pendingOrg } as any,
    );
    await assert.rejects(() => service.login({ email: coordinator.email, password: 'secret' }), UnauthorizedException);
    await assert.rejects(() => service.login({ email: coordinator.email, password: 'secret', organizationSlug: 'alpha' }), UnauthorizedException);
  } finally {
    if (previousPortalMode === undefined) delete process.env.STRICT_LOGIN_PORTAL;
    else process.env.STRICT_LOGIN_PORTAL = previousPortalMode;
  }
});

test('existing JWTs use current organization state and expose only a non-enumerable pending marker', async () => {
  let organization = activeOrg;
  let user = admin;
  const strategy = new JwtStrategy(
    new ConfigService({ JWT_SECRET: '0123456789abcdef0123456789abcdef' }),
    { validateUser: async () => ({ ...user }) } as any,
    { findOne: async ({ where }: any) => where.id === 'org-a' ? organization : null } as any,
  );
  assert.equal((await strategy.validate({ sub: user.id }) as any)[pendingLegalValidation], undefined);
  organization = pendingOrg;
  const pendingUser = await strategy.validate({ sub: user.id });
  assert.equal((pendingUser as any)[pendingLegalValidation], true);
  assert.equal(Object.getOwnPropertyDescriptor(pendingUser, pendingLegalValidation)?.enumerable, false);
  user = coordinator;
  await assert.rejects(() => strategy.validate({ sub: user.id }), UnauthorizedException);
  user = admin;
  organization = inactiveOrg;
  await assert.rejects(() => strategy.validate({ sub: user.id }), UnauthorizedException);
});

test('pending admin JWT can reach only profile, organization read and legal validation', () => {
  const pendingUser = { [pendingLegalValidation]: true };
  assert.doesNotThrow(() => assertPendingLegalRoute(pendingUser, UserController.prototype.getProfile));
  assert.doesNotThrow(() => assertPendingLegalRoute(pendingUser, CurrentOrganizationController.prototype.getCurrent));
  assert.doesNotThrow(() => assertPendingLegalRoute(pendingUser, CurrentOrganizationController.prototype.validateLegalDocuments));
  assert.throws(() => assertPendingLegalRoute(pendingUser, CurrentOrganizationController.prototype.updateCurrent), ForbiddenException);
  assert.throws(() => assertPendingLegalRoute(pendingUser, UserController.prototype.findAll), ForbiddenException);
  assert.doesNotThrow(() => assertPendingLegalRoute({}, UserController.prototype.findAll));
});

test('profile response excludes the persisted password hash and relations', () => {
  const controller = new UserController({} as any);
  const profile = controller.getProfile({ ...admin, password: 'stored-hash', organization: { name: 'Private' } } as any);
  assert.equal(profile.email, admin.email);
  assert.equal(profile.role, UserRole.ADMIN);
  assert.equal(Object.prototype.hasOwnProperty.call(profile, 'password'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(profile, 'organization'), false);
});
