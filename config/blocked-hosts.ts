/**
 * Hostname patterns that must never be targeted by automation. A blocked
 * pattern always wins over the approved staging allowlist. Runtime values
 * (QA_BLOCKED_HOST_PATTERNS) can only add blocks, never remove these.
 */
export const BLOCKED_HOST_PATTERNS: readonly RegExp[] = [
  /(^|\.)internetticketing\.com$/i,
  /^(www\.)?jacro\.com$/i,
  /^(www\.)?tapos\.com$/i,
  /(^|\.)prod(uction)?[.-]/i,
  /[.-]prod(uction)?\./i,
  /(^|\.)live[.-]/i,
];
