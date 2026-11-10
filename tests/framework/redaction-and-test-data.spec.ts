import { expect, test } from '@playwright/test';
import { REDACTED, redactEmail, redactText, redactUrl } from '../../shared/safety/redaction';
import { testInboxAddress, uniquePlusAddress } from '../../shared/test-data/test-inbox';

test.describe('redaction', () => {
  test('removes token-like query parameters and path segments', () => {
    const redacted = redactUrl('https://qa.example/verify/AbCdEfGhIjKlMnOpQrStUvWxYz0123?token=secret123&lang=en#frag');
    expect(redacted).not.toContain('secret123');
    expect(redacted).not.toContain('AbCdEfGhIjKlMnOpQrStUvWxYz0123');
    expect(redacted).toContain('lang=en');
    expect(redacted).toContain(REDACTED);
  });

  test('masks email local parts but keeps the domain', () => {
    expect(redactEmail('qa.inbox+a06-1234@mail.qa.example')).toBe('qa***@mail.qa.example');
  });

  test('redacts URLs, emails, and key=value secrets inside free text', () => {
    const text = redactText('Failed at https://qa.example/v?code=999999 for person@qa.example password=hunter2!');
    expect(text).not.toMatch(/999999|person@|hunter2/);
  });
});

test.describe('TEST inbox addresses', () => {
  const env = { QA_TEST_INBOX_ADDRESS: 'qa.inbox@mail.qa.example', QA_TEST_INBOX_ALLOWED_DOMAINS: 'mail.qa.example' };

  test('generates unique plus-addresses on the approved TEST domain', () => {
    const first = uniquePlusAddress('A06', env);
    const second = uniquePlusAddress('A06', env);
    expect(first).toMatch(/^qa\.inbox\+a06-\d{12}-[0-9a-f]{6}@mail\.qa\.example$/);
    expect(first).not.toBe(second);
  });

  test('refuses inbox domains that are not explicitly approved', () => {
    expect(() => testInboxAddress({ ...env, QA_TEST_INBOX_ALLOWED_DOMAINS: '' })).toThrow(/not listed/);
    expect(() => testInboxAddress({})).toThrow(/not configured/);
    expect(() => testInboxAddress({ ...env, QA_TEST_INBOX_ADDRESS: 'qa+tag@mail.qa.example' })).toThrow(/without "\+"/);
  });
});
