import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ActivationRedeemSchema,
  ContactLeadCreateSchema,
  ContactLeadStatusSchema,
  CustomerBusinessProfileSchema,
  CustomerRegisterSchema,
  CustomerResetPasswordSchema,
  DeviceHeartbeatSchema,
  LoginRequestSchema,
  ResellerCreateSchema,
  ResellerSlugSchema,
  SaleCreateSchema,
} from './index.js';

describe('@milioner/contracts', () => {
  it('parses login request', () => {
    const parsed = LoginRequestSchema.parse({
      email: 'a@b.co',
      password: 'x',
    });
    assert.equal(parsed.email, 'a@b.co');
  });

  it('parses activation redeem', () => {
    const parsed = ActivationRedeemSchema.parse({
      activationKey: 'AAAA-BBBB-CCCC-DDDD',
      deviceFingerprint: 'fingerprint-1',
    });
    assert.equal(parsed.deviceFingerprint, 'fingerprint-1');
  });

  it('defaults reseller quota to zero', () => {
    const parsed = ResellerCreateSchema.parse({
      name: 'Test Bayi',
      slug: 'test-bayi',
      email: 'bayi@milioner.az',
      password: 'parol1234',
    });
    assert.equal(parsed.keyQuota, 0);
  });

  it('rejects slugs that would break the panel URL', () => {
    for (const bad of ['Test Bayi', 'bayi_1', '-bayi', 'bayi-', 'ab', 'bayi/admin']) {
      assert.equal(ResellerSlugSchema.safeParse(bad).success, false, bad);
    }
    assert.equal(ResellerSlugSchema.safeParse('test-bayi-2').success, true);
  });

  it('parses a sale with default days', () => {
    const parsed = SaleCreateSchema.parse({
      name: 'Restoran A',
      email: 'a@restoran.az',
      password: 'parol1234',
      address: 'Bakı, Nizami küç. 12',
    });
    assert.equal(parsed.days, 30);
    assert.equal(parsed.seats, 1);
  });

  it('requires an address but not a VÖEN', () => {
    const base = { name: 'A', email: 'a@b.az', password: 'parol1234' };
    assert.equal(SaleCreateSchema.safeParse(base).success, false);
    assert.equal(SaleCreateSchema.safeParse({ ...base, address: '' }).success, false);
    assert.equal(SaleCreateSchema.safeParse({ ...base, address: 'Bakı' }).success, true);
  });

  it('normalises blank optional fields to null', () => {
    const parsed = SaleCreateSchema.parse({
      name: 'A',
      email: 'a@b.az',
      password: 'parol1234',
      address: 'Bakı',
      voen: '   ',
      phone: '',
      contactPerson: '  Əli Məmmədov  ',
      notes: null,
    });
    assert.equal(parsed.voen, null);
    assert.equal(parsed.phone, null);
    assert.equal(parsed.contactPerson, 'Əli Məmmədov');
    assert.equal(parsed.notes, null);
  });

  it('validates and normalises public contact leads', () => {
    const parsed = ContactLeadCreateSchema.parse({
      name: '  Əli Məmmədov  ',
      businessName: ' Milioner Lounge ',
      phone: '+994 55 347 46 87',
      city: ' Bakı ',
      message: '',
    });
    assert.equal(parsed.name, 'Əli Məmmədov');
    assert.equal(parsed.businessName, 'Milioner Lounge');
    assert.equal(parsed.city, 'Bakı');
    assert.equal(parsed.message, null);
    assert.equal(parsed.source, 'website');
  });

  it('rejects invalid lead phones and statuses', () => {
    assert.equal(
      ContactLeadCreateSchema.safeParse({
        name: 'Əli',
        businessName: 'Test Restoran',
        phone: 'javascript:alert(1)',
      }).success,
      false,
    );
    assert.equal(ContactLeadStatusSchema.safeParse({ status: 'deleted' }).success, false);
  });

  it('validates customer registration and normalises email', () => {
    const parsed = CustomerRegisterSchema.parse({
      name: 'Əli Məmmədov',
      businessName: 'Milioner Lounge',
      email: ' OWNER@Example.AZ ',
      password: 'uzun-ve-tehlukesiz-parol',
      termsAccepted: true,
    });
    assert.equal(parsed.email, 'owner@example.az');
    assert.equal(parsed.termsAccepted, true);
    assert.equal(
      CustomerRegisterSchema.safeParse({ ...parsed, termsAccepted: false }).success,
      false,
    );
  });

  it('requires strong customer reset passwords and valid business details', () => {
    assert.equal(
      CustomerResetPasswordSchema.safeParse({
        token: 'a'.repeat(43),
        password: 'short',
      }).success,
      false,
    );
    const profile = CustomerBusinessProfileSchema.parse({
      businessName: 'Milioner Lounge',
      contactPerson: 'Əli Məmmədov',
      phone: '+994 55 347 46 87',
      address: 'Bakı, Nizami küçəsi 12',
      voen: '',
      notifyEmail: 'OWNER@EXAMPLE.AZ',
    });
    assert.equal(profile.voen, null);
    assert.equal(profile.notifyEmail, 'owner@example.az');
  });

  it('supports staged fingerprint authentication for device heartbeats', () => {
    assert.equal(DeviceHeartbeatSchema.safeParse({ appVersion: '1.3.18' }).success, true);
    const authenticated = DeviceHeartbeatSchema.parse({
      deviceFingerprint: 'fingerprint-1234',
      appVersion: '1.3.19',
    });
    assert.equal(authenticated.deviceFingerprint, 'fingerprint-1234');
    assert.equal(
      DeviceHeartbeatSchema.safeParse({ deviceFingerprint: 'short' }).success,
      false,
    );
  });
});
