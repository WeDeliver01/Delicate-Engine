declare module "pdfkit" {
  interface PDFDocumentOptions {
    size?: string | [number, number];
    margin?: number;
    margins?: { top: number; bottom: number; left: number; right: number };
    info?: Record<string, string>;
    bufferPages?: boolean;
  }
  class PDFDocument {
    constructor(options?: PDFDocumentOptions);
    pipe(dest: NodeJS.WritableStream): this;
    end(): void;
    on(event: string, listener: (...args: unknown[]) => void): this;
    text(text: string, options?: Record<string, unknown>): this;
    text(text: string, x?: number, y?: number, options?: Record<string, unknown>): this;
    fontSize(size: number): this;
    font(font: string): this;
    moveDown(lines?: number): this;
    addPage(options?: PDFDocumentOptions): this;
    fillColor(color: string): this;
    strokeColor(color: string): this;
    rect(x: number, y: number, w: number, h: number): this;
    fill(): this;
    stroke(): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    page: { width: number; height: number; margins: { top: number; bottom: number; left: number; right: number } };
    y: number;
    x: number;
  }
  export = PDFDocument;
}
