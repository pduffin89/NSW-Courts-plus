export function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function slug(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

export function dedupeBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function smartCase(value: unknown): string {
  const forcedUpper = new Set(['NSW', 'ACT', 'QLD', 'VIC', 'WA', 'SA', 'NT', 'TAS', 'PTY', 'LTD', 'LLC', 'ABC', 'ASIC']);
  const minor = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to']);
  return cleanText(value)
    .split(' ')
    .filter(Boolean)
    .map((token, index) => {
      const match = token.match(/^([^A-Za-z0-9']*)(.*?)([^A-Za-z0-9']*)$/);
      if (!match) return token;
      const [, lead, core, trail] = match;
      if (!core) return token;
      const upper = core.toUpperCase();
      if (forcedUpper.has(upper)) return `${lead}${upper}${trail}`;
      const titled = core
        .split('-')
        .map((part) => part.split("'").map((piece) => piece ? piece[0].toUpperCase() + piece.slice(1).toLowerCase() : piece).join("'"))
        .join('-');
      const normalized = index > 0 && minor.has(titled.toLowerCase()) ? titled.toLowerCase() : titled;
      return `${lead}${normalized}${trail}`;
    })
    .join(' ');
}

export function stripWrappingQuotes(value: string): string {
  return cleanText(value).replace(/^['\"]+|['\"]+$/g, '').trim();
}
