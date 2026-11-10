/**
 * Hostname patterns that must never be targeted by automation.
 *
 * Known production hostnames for TaPoS/JACRO products must be added here once
 * confirmed. Additional patterns can be supplied at runtime through
 * QA_BLOCKED_HOST_PATTERNS, but runtime values can only add blocks, never
 * remove these.
 */
export const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^(www\.)?jacro\.com$/i,
  /^(www\.)?tapos\.com$/i,
  /(^|\.)prod(uction)?[.-]/i,
  /[.-]prod(uction)?\./i,
  /(^|\.)live[.-]/i,
];
