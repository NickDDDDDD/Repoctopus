const DEFAULT_SUMMARY_BYTES = 1024 * 1024;

export interface BoundedTextResult {
  contents: string;
  bytesSeen: number;
  truncated: boolean;
}

export class BoundedTextCapture {
  private readonly full: Buffer[] = [];
  private totalBytes = 0;
  private truncated = false;
  private head = Buffer.alloc(0);
  private tail = Buffer.alloc(0);

  constructor(
    private readonly maxBytes: number,
    private readonly summaryLines = 200,
    private readonly summaryBytes = Math.min(DEFAULT_SUMMARY_BYTES, Math.max(4096, maxBytes)),
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new Error('Capture maxBytes must be a positive integer');
    }
  }

  append(value: string | Buffer): void {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
    this.totalBytes += bytes.byteLength;
    if (!this.truncated && this.totalBytes <= this.maxBytes) {
      this.full.push(bytes);
      return;
    }
    if (!this.truncated) {
      this.truncated = true;
      const retained = Buffer.concat([...this.full, bytes]);
      this.full.length = 0;
      this.head = retained.subarray(0, this.summaryBytes);
      this.tail = retained.subarray(Math.max(0, retained.byteLength - this.summaryBytes));
      return;
    }
    this.tail = Buffer.concat([this.tail, bytes]).subarray(
      Math.max(0, this.tail.byteLength + bytes.byteLength - this.summaryBytes),
    );
  }

  finish(): BoundedTextResult {
    if (!this.truncated) {
      return {
        contents: Buffer.concat(this.full).toString('utf8'),
        bytesSeen: this.totalBytes,
        truncated: false,
      };
    }
    const first = this.head.toString('utf8').split(/\r?\n/u).slice(0, this.summaryLines);
    const last = this.tail.toString('utf8').split(/\r?\n/u).slice(-this.summaryLines);
    return {
      contents: `${first.join('\n')}\n... [truncated after ${this.totalBytes} bytes] ...\n${last.join('\n')}`,
      bytesSeen: this.totalBytes,
      truncated: true,
    };
  }
}
