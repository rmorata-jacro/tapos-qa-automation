import { randomBytes } from 'node:crypto';

type Env = Record<string, string | undefined>;

export class TestDataPrerequisiteError extends Error {
  constructor(message: string) {
    super(`TEST DATA PREREQUISITE NOT MET: ${message}`);
    this.name = 'TestDataPrerequisiteError';
  }
}

export interface TestInboxAddress {
  base: string;
  local: string;
  domain: string;
}

/**
 * The base TEST inbox (QA_TEST_INBOX_ADDRESS) must belong to a domain listed in
 * QA_TEST_INBOX_ALLOWED_DOMAINS so that generated addresses can never reach
 * real customers.
 */
export function testInboxAddress(env: Env = process.env): TestInboxAddress {
  const base = env.QA_TEST_INBOX_ADDRESS?.trim();
  if (!base) throw new TestDataPrerequisiteError('QA_TEST_INBOX_ADDRESS is not configured.');
  const match = /^([^@+\s]+)@([^@\s]+\.[^@\s]+)$/.exec(base);
  if (!match) throw new TestDataPrerequisiteError('QA_TEST_INBOX_ADDRESS must be a plain address without "+" tags.');
  const [, local, domain] = match;
  const allowed = (env.QA_TEST_INBOX_ALLOWED_DOMAINS ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(domain.toLowerCase())) {
    throw new TestDataPrerequisiteError(`Inbox domain "${domain}" is not listed in QA_TEST_INBOX_ALLOWED_DOMAINS.`);
  }
  return { base, local, domain };
}

/** Unique per call so tests never depend on addresses created by earlier runs. */
export function uniquePlusAddress(purpose: string, env: Env = process.env): string {
  const { local, domain } = testInboxAddress(env);
  const tag = purpose.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
  return `${local}+${tag}-${stamp}-${randomBytes(3).toString('hex')}@${domain}`;
}

export interface InboxMessageSummary {
  subject: string;
  receivedAt: Date;
}

/**
 * Read-only access to the TEST mailbox. Implementations must never log or
 * return message bodies to reports; links are returned in memory only.
 */
export interface TestInbox {
  waitForLink(recipient: string, options: { subject: RegExp; linkPattern: RegExp; timeoutMs: number }): Promise<URL>;
  listMessages(recipient: string, options: { subject: RegExp }): Promise<InboxMessageSummary[]>;
}

export function resolveTestInbox(env: Env = process.env): TestInbox {
  const adapter = env.QA_TEST_INBOX_ADAPTER;
  throw new TestDataPrerequisiteError(
    adapter
      ? `Test inbox adapter "${adapter}" is not implemented yet. Add it in shared/test-data/ once the TEST mailbox provider is confirmed.`
      : 'No test inbox adapter configured (QA_TEST_INBOX_ADAPTER). The TEST mailbox provider for INT-3437 has not been confirmed.',
  );
}
