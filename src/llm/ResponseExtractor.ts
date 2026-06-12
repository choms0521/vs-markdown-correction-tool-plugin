export class ResponseExtractor {
  extract(raw: string): string {
    const match = raw.match(/```(?:markdown|md)?\n([\s\S]*?)\n```/);
    if (match) {
      return match[1].trim();
    }
    return raw.trim();
  }
}
