import pdfParse from "pdf-parse";

export const MAX_PAGES = 50;

export interface PdfPage {
  page: number;
  text: string;
}

export interface ParsedPdf {
  numPages: number;
  pages: PdfPage[];
  fullText: string;
}

export class PdfTooLargeError extends Error {
  constructor(public pages: number) {
    super(`PDF has ${pages} pages, exceeds limit of ${MAX_PAGES}`);
    this.name = "PdfTooLargeError";
  }
}

export async function parsePdf(buffer: Buffer): Promise<ParsedPdf> {
  const pages: PdfPage[] = [];
  let currentPage = 0;
  let tooLarge = false;

  const data = await pdfParse(buffer, {
    pagerender: async (pageData: any) => {
      currentPage += 1;
      if (currentPage > MAX_PAGES) {
        tooLarge = true;
        return "";
      }
      const textContent = await pageData.getTextContent();
      const text = textContent.items.map((i: any) => i.str).join(" ");
      pages.push({ page: currentPage, text });
      return text;
    },
  });

  if (tooLarge || data.numpages > MAX_PAGES) {
    throw new PdfTooLargeError(data.numpages);
  }

  pages.sort((a, b) => a.page - b.page);
  return { numPages: data.numpages, pages, fullText: data.text };
}

// %PDF magic bytes at the start of the file
export function isPdfMagic(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
}
