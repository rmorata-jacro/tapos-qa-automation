import { redactUrl } from '../safety/redaction';

export const SECURITY_CHALLENGE_ANNOTATION = 'security-challenge';
export const SECURITY_CHALLENGE_CLASSIFICATION = 'BLOCKED — Infrastructure / Security Challenge';

/** Response headers safe to keep as evidence. Cookies and reporting endpoints are excluded. */
const EVIDENCE_HEADERS = ['server', 'cf-mitigated', 'cf-ray', 'content-type', 'date'];

export interface ResponseObservation {
  url: string;
  status: number;
  headers: Record<string, string>;
  /** Document title, when known. */
  title?: string;
  /** Leading part of the response body, when available. */
  body?: string;
}

export interface SecurityChallenge {
  vendor: 'Cloudflare';
  /** Challenge type reported by the page (e.g. "managed"), or "unknown". */
  challengeType: string;
  status: number;
  rayId?: string;
  url: string;
  evidence: string[];
  headers: Record<string, string>;
}

function lowerCaseKeys(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
}

/**
 * Identifies a Cloudflare security challenge from response evidence.
 * `cf-mitigated: challenge` is Cloudflare's explicit marker. Without it, a
 * response counts only if it is served by Cloudflare with a blocking status
 * and also carries the challenge page title or challenge-platform markers,
 * so an application's own HTTP 403 is never treated as a challenge.
 */
export function detectSecurityChallenge(observation: ResponseObservation): SecurityChallenge | undefined {
  const headers = lowerCaseKeys(observation.headers);
  const evidence: string[] = [];

  const mitigated = headers['cf-mitigated']?.trim().toLowerCase() === 'challenge';
  if (mitigated) evidence.push('cf-mitigated: challenge');

  const servedByCloudflare = headers['server']?.trim().toLowerCase() === 'cloudflare';
  const blockingStatus = [403, 429, 503].includes(observation.status);
  const challengeTitle = /^just a moment\.\.\.$/i.test(observation.title?.trim() ?? '');
  const challengeBody = /window\._cf_chl_opt|\/cdn-cgi\/challenge-platform\//.test(observation.body ?? '');
  if (servedByCloudflare && blockingStatus) {
    if (challengeTitle) evidence.push('title: Just a moment...');
    if (challengeBody) evidence.push('body: Cloudflare challenge-platform markers');
  }

  if (!mitigated && !(servedByCloudflare && blockingStatus && (challengeTitle || challengeBody))) return undefined;

  if (servedByCloudflare) evidence.push('server: cloudflare');
  evidence.push(`HTTP ${observation.status}`);
  return {
    vendor: 'Cloudflare',
    challengeType: /cType:\s*'([a-z_]+)'/.exec(observation.body ?? '')?.[1] ?? 'unknown',
    status: observation.status,
    rayId: headers['cf-ray'],
    url: redactUrl(observation.url),
    evidence,
    headers: Object.fromEntries(EVIDENCE_HEADERS.filter((name) => headers[name]).map((name) => [name, headers[name]])),
  };
}

export function describeSecurityChallenge(challenge: SecurityChallenge): string {
  return [
    `${SECURITY_CHALLENGE_CLASSIFICATION}: ${challenge.vendor} ${challenge.challengeType} challenge`,
    `HTTP ${challenge.status}`,
    challenge.rayId ? `ray ${challenge.rayId}` : 'no ray id',
    challenge.url,
    `evidence: ${challenge.evidence.join(', ')}`,
  ].join(' | ');
}
