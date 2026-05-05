// ════════════════════════════════════════════════════════
// Shared Email Extraction & Validation Utilities
// Used by all enrichment strategies
// ════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────

export const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

export const JUNK_DOMAINS = new Set([
  'sentry.io', 'wixpress.com', 'example.com', 'domain.com', 'email.com',
  'yoursite.com', 'yourdomain.com', 'test.com', 'placeholder.com',
  'w3.org', 'schema.org', 'googleapis.com', 'google.com', 'facebook.com',
  'twitter.com', 'instagram.com', 'apple.com', 'microsoft.com',
  'yelp.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'gmail.com',
  'aol.com', 'icloud.com', 'me.com', 'live.com',
]);

export const JUNK_PREFIXES = new Set([
  'noreply', 'no-reply', 'donotreply', 'webmaster', 'postmaster',
  'mailer-daemon', 'root', 'admin@wordpress',
]);

export const JUNK_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.css', '.js',
  '.woff', '.woff2', '.ttf', '.eot', '.ico',
]);

// ────────────────────────────────────────────────────
// Email validation & extraction
// ────────────────────────────────────────────────────

export function isValidBusinessEmail(email: string): boolean {
  const lower = email.toLowerCase();
  const domain = lower.split('@')[1];
  const prefix = lower.split('@')[0];

  if (!domain || domain.length < 4) return false;

  // Exact domain match
  if (JUNK_DOMAINS.has(domain)) return false;

  // Subdomain match (e.g., sentry-next.wixpress.com → wixpress.com)
  for (const junkDomain of JUNK_DOMAINS) {
    if (domain.endsWith('.' + junkDomain)) return false;
  }

  if (JUNK_PREFIXES.has(prefix)) return false;

  // Check if domain looks like a file extension (e.g., 2x.png)
  const domainExt = '.' + domain.split('.').pop();
  if (JUNK_EXTENSIONS.has(domainExt)) return false;

  // Check if the ENTIRE email looks like a file (e.g., logo_250x@2x.png)
  const fullExt = '.' + lower.split('.').pop();
  if (JUNK_EXTENSIONS.has(fullExt)) return false;

  // Reject emails with hex-hash-like prefixes (Sentry, tracking IDs)
  if (/^[0-9a-f]{16,}$/.test(prefix)) return false;

  if (lower.includes('..') || lower.startsWith('.') || lower.endsWith('.')) return false;
  if (email.length > 80) return false;

  return true;
}

export function extractEmails(html: string): string[] {
  const allEmails: string[] = [];

  // 1. Standard regex extraction from visible text
  const regexMatches = html.match(EMAIL_REGEX) || [];
  allEmails.push(...regexMatches);

  // 2. Extract from mailto: links (often obfuscated from plain text)
  const mailtoRegex = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
  let mailtoMatch;
  while ((mailtoMatch = mailtoRegex.exec(html)) !== null) {
    allEmails.push(mailtoMatch[1]);
  }

  // 3. Extract from data attributes and JSON-LD structured data
  const jsonLdRegex = /"email"\s*:\s*"([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})"/gi;
  let jsonMatch;
  while ((jsonMatch = jsonLdRegex.exec(html)) !== null) {
    allEmails.push(jsonMatch[1]);
  }

  const unique = [...new Set(allEmails.map(e => e.toLowerCase()))];
  return unique.filter(isValidBusinessEmail);
}

/**
 * Prioritize the best email from a list.
 * Prefer: info@ > contact@ > hello@ > owner@ > salon@ > others
 */
export function pickBestEmail(emails: string[]): string | null {
  if (emails.length === 0) return null;

  const priority = [
    'info@', 'contact@', 'hello@', 'owner@', 'salon@',
    'appointments@', 'booking@', 'office@', 'admin@',
  ];

  for (const prefix of priority) {
    const match = emails.find(e => e.startsWith(prefix));
    if (match) return match;
  }

  return emails[0];
}

// ────────────────────────────────────────────────────
// Yelp URL detection
// ────────────────────────────────────────────────────

export function isYelpListingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname.includes('yelp.com') && u.pathname.startsWith('/biz/');
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────
// Domain guessing from business name
// ────────────────────────────────────────────────────

export function generateDomainGuesses(businessName: string, city?: string): string[] {
  const clean = businessName.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const stopWords = new Set(['the', 'and', 'of', 'a', 'an', 'at', 'in', 'on', 'by', 'for', 'to', 'llc', 'inc']);
  const filtered = words.filter(w => !stopWords.has(w));

  const slugs = new Set<string>();
  slugs.add(words.join(''));
  slugs.add(words.join('-'));
  if (filtered.length > 0 && filtered.length !== words.length) {
    slugs.add(filtered.join(''));
    slugs.add(filtered.join('-'));
  }
  if (city) {
    const cs = city.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cs) {
      slugs.add((filtered.length > 0 ? filtered : words).join('') + cs);
      slugs.add(words.join('') + cs);
    }
  }

  const domains: string[] = [];
  for (const slug of slugs) {
    if (slug.length < 3 || slug.length > 60) continue;
    domains.push(`https://www.${slug}.com`);
    domains.push(`https://${slug}.com`);
  }
  return domains;
}

export async function resolveWebsiteByGuessing(businessName: string, city?: string): Promise<string | null> {
  const candidates = generateDomainGuesses(businessName, city);
  if (candidates.length === 0) return null;

  const results = await Promise.allSettled(
    candidates.map(async (url) => {
      try {
        const r = await fetch(url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(4000),
          redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InfoIQ/1.0)' },
        });
        if (r.ok || r.status === 301 || r.status === 302) return url;
      } catch { /* expected for non-existent domains */ }
      return null;
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) return r.value;
  }
  return null;
}

// ────────────────────────────────────────────────────
// Website scraping — EXPANDED subpage coverage
// Checks: homepage, /contact, /about, /contact-us,
//         /team, /staff, /about-us, /our-team, /our-story
// ────────────────────────────────────────────────────

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
};

/** Subpages to check for email, in priority order */
const SUBPAGES = [
  '/contact',
  '/about',
  '/contact-us',
  '/about-us',
  '/team',
  '/staff',
  '/our-team',
  '/our-story',
];

/**
 * Fetch a single URL and extract emails from its HTML.
 * Returns empty array on failure.
 */
export async function fetchAndExtractEmails(url: string, timeoutMs = 8000): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: FETCH_HEADERS,
      redirect: 'follow',
    });
    clearTimeout(timeout);
    if (!response.ok) return [];
    const html = await response.text();
    return extractEmails(html);
  } catch {
    return [];
  }
}

/**
 * Scrape a business website (+ subpages) for emails.
 * Enhanced: checks 9 paths total for maximum email discovery.
 */
export async function scrapeEmailFromWebsite(websiteUrl: string): Promise<{ email: string | null; allEmails: string[] }> {
  const allEmails: string[] = [];

  // 1. Check homepage first
  const homepageEmails = await fetchAndExtractEmails(websiteUrl);
  allEmails.push(...homepageEmails);

  // If homepage yielded a good email, return early
  if (allEmails.length > 0) {
    const uniqueEmails = [...new Set(allEmails)];
    return { email: pickBestEmail(uniqueEmails), allEmails: uniqueEmails };
  }

  // 2. Check all subpages in parallel (since homepage found nothing)
  try {
    const base = new URL(websiteUrl);
    const subpageUrls = SUBPAGES.map(path => `${base.origin}${path}`);

    const subResults = await Promise.allSettled(
      subpageUrls.map(url => fetchAndExtractEmails(url, 6000))
    );

    for (const r of subResults) {
      if (r.status === 'fulfilled') {
        allEmails.push(...r.value);
      }
    }
  } catch { /* invalid URL */ }

  const uniqueEmails = [...new Set(allEmails)];
  return { email: pickBestEmail(uniqueEmails), allEmails: uniqueEmails };
}

/**
 * Resolve a real website URL from any input (handles Yelp URLs).
 */
export async function resolveWebsiteUrl(
  inputUrl: string,
  businessName?: string,
  city?: string
): Promise<string | null> {
  // Yelp redirect URL → extract real URL
  if (inputUrl.includes('yelp.com/biz_redir')) {
    try {
      const u = new URL(inputUrl);
      const real = u.searchParams.get('url');
      if (real) return real;
    } catch { /* ignore */ }
  }

  // Yelp listing URL → try domain guessing
  if (isYelpListingUrl(inputUrl) && businessName) {
    return resolveWebsiteByGuessing(businessName, city);
  }

  // Non-Yelp URL → probably the real website
  if (!inputUrl.includes('yelp.com')) {
    return inputUrl;
  }

  return null;
}
