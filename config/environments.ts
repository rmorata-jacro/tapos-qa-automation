/**
 * Approved automation targets. These are code constants on purpose: the
 * runtime environment may select a target but can never widen this list.
 * Adding a host requires a reviewed change to this file.
 */
export const APPROVED_STAGING = {
  name: 'TaPoS staging (INT-3437)',
  baseUrl: 'https://it.taposapp.com',
  hosts: ['it.taposapp.com'],
} as const;

/** Production entry points. Never targeted; listed so guards and tests can refer to them explicitly. */
export const PRODUCTION_URLS = ['https://my.internetticketing.com'] as const;

/** Shared staging hosts. Suite C (failure injection) must never run against these. */
export const SHARED_STAGING_HOSTS = ['it.taposapp.com'] as const;

/**
 * Database hosts approved for read-only INT-3437 verification (Websales,
 * Membership, POS). Empty until the staging database hosts are confirmed, so
 * every E2E run that needs database checks fails closed.
 */
export const APPROVED_STAGING_DATABASE_HOSTS: readonly string[] = [];
