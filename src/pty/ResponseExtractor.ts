/**
 * Extracts the actual markdown response body from a raw buffer.
 * Prefers a fenced ```markdown / ```md block if present, otherwise
 * falls back to the trimmed raw buffer.
 */
export class ResponseExtractor {
  extract(raw: string): string {
    const fenceMatch = raw.match(/```(?:markdown|md)?\n([\s\S]*?)\n```/);
    if (fenceMatch) return fenceMatch[1].trim();
    return raw.trim();
  }
}
