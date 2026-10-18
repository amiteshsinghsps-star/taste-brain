export class ChunkerService {
  /**
   * Cleans raw text/HTML content and breaks it into overlapping chunk windows.
   */
  static chunkText(
    rawText: string,
    chunkSize: number = 600,
    overlap: number = 100
  ): string[] {
    if (!rawText) return [];

    // Clean HTML tags and normalize whitespace
    const cleanText = rawText
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanText.length <= chunkSize) {
      return [cleanText];
    }

    const chunks: string[] = [];
    let start = 0;

    while (start < cleanText.length) {
      const end = Math.min(start + chunkSize, cleanText.length);
      const chunk = cleanText.substring(start, end);
      chunks.push(chunk.trim());

      if (end === cleanText.length) break;
      start += chunkSize - overlap;
    }

    return chunks;
  }
}
