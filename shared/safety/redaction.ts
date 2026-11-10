const SENSITIVE_PARAM = /token|code|key|pass(word)?|secret|sig(nature)?|auth|session|otp|hash/i;
/** Path segments that look like opaque tokens (long base64url / hex / JWT-like). */
const TOKEN_LIKE_SEGMENT = /^[A-Za-z0-9_\-.~%]{20,}$/;
const EMAIL = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

export const REDACTED = '[REDACTED]';

export function redactUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return redactText(rawUrl);
  }
  url.username = url.username ? REDACTED : '';
  url.password = url.password ? REDACTED : '';
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_PARAM.test(key)) url.searchParams.set(key, REDACTED);
  }
  url.pathname = url.pathname
    .split('/')
    .map((segment) => (TOKEN_LIKE_SEGMENT.test(segment) ? REDACTED : segment))
    .join('/');
  if (url.hash.length > 1) url.hash = REDACTED;
  return decodeURIComponent(url.toString());
}

export function redactEmail(email: string): string {
  return email.replace(EMAIL, (_match, local: string, domain: string) => `${local.slice(0, 2)}***@${domain}`);
}

/** Redacts URLs, emails, and key=value secrets embedded in free text (e.g. error messages). */
export function redactText(text: string): string {
  return text
    .replace(/https?:\/\/[^\s'"<>)]+/g, (match) => redactUrl(match))
    .replace(EMAIL, (match) => redactEmail(match))
    .replace(/((?:token|password|secret|code)["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi, `$1${REDACTED}`);
}
