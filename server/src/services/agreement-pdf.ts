import { Parser } from 'htmlparser2';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import { AGREEMENT_PDF_FOOTER } from '@fap/shared';

// Builds the final agreement PDF (PRD §9.2, 9.3): A4, brand colour, details pages, the agreement
// itself, the acceptance record and dates, with the mandatory footer and "Page X of Y" on every page.

export interface AgreementPdfInput {
  organisationName: string;
  primaryColor: string;
  /** Logo from Settings as a data: URL (PNG or JPEG), if any. */
  logoDataUrl: string | null;
  title: string;
  referenceNumber: string;
  agreementVersionNumber: number;
  details: {
    franchiseModel: string;
    firmType: string;
    firmName: string;
    pan: string;
    gst: string | null;
    signatory: { name: string; capacity: string; email: string; mobile: string };
    contacts: { name: string; mobile: string; email: string }[];
  };
  /** Typed agreement: personalised HTML. PDF agreement: the uploaded file. */
  content: { format: 'text'; html: string } | { format: 'pdf'; bytes: Uint8Array };
  acceptedBy: string;
  acceptedAt: string; // already formatted for display (IST)
  approvedAt: string;
  generatedAt: string;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 50;
const FOOTER_BAND = 58; // space reserved at the bottom of every page for the footer
const TEXT = rgb(0.12, 0.16, 0.22);
const MUTED = rgb(0.39, 0.45, 0.53);
const LINE = rgb(0.85, 0.87, 0.9);

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return rgb(0.12, 0.23, 0.54);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
}

interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

/** Keeps text printable with the built-in fonts; unsupported symbols become close equivalents or "?". */
function makeSafe(font: PDFFont) {
  const cache = new Map<string, string>();
  const replacements: Record<string, string> = { '₹': 'Rs.', ' ': ' ', '​': '', '\t': ' ' };
  return (text: string) =>
    Array.from(text.replace(/\r?\n/g, ' '))
      .map((ch) => {
        if (cache.has(ch)) return cache.get(ch)!;
        let out = replacements[ch] ?? ch;
        try {
          font.encodeText(out);
        } catch {
          out = '?';
        }
        cache.set(ch, out);
        return out;
      })
      .join('');
}

/** A tiny page-layout engine: flowing text with word wrap, headings, tables and page breaks. */
class Writer {
  page!: PDFPage;
  y = 0;
  readonly width = A4[0] - MARGIN * 2;
  safe: (t: string) => string;

  constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
    readonly brand: RGB,
  ) {
    this.safe = makeSafe(fonts.regular);
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - MARGIN;
  }

  ensure(height: number) {
    if (this.y - height < FOOTER_BAND + 10) this.newPage();
  }

  font(run: Run) {
    const { regular, bold, italic, boldItalic } = this.fonts;
    return run.bold && run.italic ? boldItalic : run.bold ? bold : run.italic ? italic : regular;
  }

  gap(h: number) {
    this.y -= h;
  }

  /** Word-wrapped text made of styled runs. */
  paragraph(runs: Run[], opts: { size?: number; indent?: number; color?: RGB; prefix?: string; lineGap?: number } = {}) {
    const size = opts.size ?? 10.5;
    const indent = opts.indent ?? 0;
    const lineHeight = size * (opts.lineGap ?? 1.45);
    const maxWidth = this.width - indent;
    const words: { text: string; font: PDFFont; space: boolean }[] = [];
    for (const run of runs) {
      const text = this.safe(run.text);
      const font = this.font(run);
      for (const part of text.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) words.push({ text: ' ', font, space: true });
        else words.push({ text: part, font, space: false });
      }
    }
    if (!words.some((w) => !w.space)) return;

    const lines: (typeof words)[] = [[]];
    let lineWidth = 0;
    for (const w of words) {
      const wWidth = w.font.widthOfTextAtSize(w.text, size);
      const current = lines[lines.length - 1];
      if (w.space) {
        if (current.length) {
          current.push(w);
          lineWidth += wWidth;
        }
        continue;
      }
      if (lineWidth + wWidth > maxWidth && current.length) {
        while (current.length && current[current.length - 1].space) current.pop();
        lines.push([w]);
        lineWidth = wWidth;
      } else {
        current.push(w);
        lineWidth += wWidth;
      }
    }

    lines.forEach((line, i) => {
      this.ensure(lineHeight);
      let x = MARGIN + indent;
      if (i === 0 && opts.prefix) {
        const pw = this.fonts.regular.widthOfTextAtSize(opts.prefix, size);
        this.page.drawText(opts.prefix, { x: x - pw - 4, y: this.y - size, size, font: this.fonts.regular, color: opts.color ?? TEXT });
      }
      for (const w of line) {
        if (!w.space) this.page.drawText(w.text, { x, y: this.y - size, size, font: w.font, color: opts.color ?? TEXT });
        x += w.font.widthOfTextAtSize(w.text, size);
      }
      this.y -= lineHeight;
    });
  }

  heading(text: string, size = 13) {
    this.ensure(size * 2.6);
    this.gap(size * 0.6);
    this.paragraph([{ text, bold: true }], { size, color: this.brand, lineGap: 1.3 });
    this.gap(2);
  }

  rule() {
    this.ensure(10);
    this.page.drawLine({ start: { x: MARGIN, y: this.y - 4 }, end: { x: MARGIN + this.width, y: this.y - 4 }, thickness: 0.6, color: LINE });
    this.gap(10);
  }

  /** Two-column label / value rows. */
  keyValues(rows: [string, string][]) {
    const labelWidth = 150;
    for (const [label, value] of rows) {
      const before = this.y;
      this.ensure(16);
      const startPage = this.page;
      this.page.drawText(this.safe(label), { x: MARGIN, y: this.y - 10, size: 9.5, font: this.fonts.bold, color: MUTED });
      this.paragraph([{ text: value || '—' }], { size: 10, indent: labelWidth, lineGap: 1.4 });
      if (this.page === startPage && before - this.y < 16) this.y = before - 16;
      this.gap(2);
    }
  }

  /** A simple table with a header row; rows wrap onto new pages. */
  table(headers: string[], widths: number[], rows: string[][]) {
    const size = 9.5;
    const rowHeight = 18;
    const drawRow = (cells: string[], header: boolean) => {
      this.ensure(rowHeight);
      if (header) this.page.drawRectangle({ x: MARGIN, y: this.y - rowHeight + 4, width: this.width, height: rowHeight, color: rgb(0.95, 0.96, 0.97) });
      let x = MARGIN + 4;
      cells.forEach((cell, i) => {
        const font = header ? this.fonts.bold : this.fonts.regular;
        let text = this.safe(cell);
        while (text.length > 1 && font.widthOfTextAtSize(text, size) > widths[i] - 8) text = `${text.slice(0, -2)}…`;
        try {
          font.encodeText(text);
        } catch {
          text = text.replace('…', '...');
        }
        this.page.drawText(text, { x, y: this.y - 10, size, font, color: header ? TEXT : TEXT });
        x += widths[i];
      });
      this.page.drawLine({ start: { x: MARGIN, y: this.y - rowHeight + 4 }, end: { x: MARGIN + this.width, y: this.y - rowHeight + 4 }, thickness: 0.4, color: LINE });
      this.y -= rowHeight;
    };
    drawRow(headers, true);
    for (const r of rows) drawRow(r, false);
    this.gap(6);
  }
}

// ---------- Typed agreement text (sanitised HTML) ----------

interface Block {
  kind: 'h2' | 'h3' | 'h4' | 'p' | 'li' | 'quote' | 'hr';
  runs: Run[];
  depth: number;
  marker?: string;
}

/** Turns the agreement's sanitised HTML into simple blocks of styled text. */
export function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  const style = { bold: 0, italic: 0 };
  const lists: { ordered: boolean; n: number }[] = [];
  let current: Block | null = null;
  let quote = 0;

  const start = (kind: Block['kind'], marker?: string) => {
    current = { kind, runs: [], depth: lists.length, marker };
    blocks.push(current);
  };
  const end = () => {
    current = null;
  };

  const parser = new Parser(
    {
      onopentag(name) {
        if (name === 'strong' || name === 'b') style.bold++;
        else if (name === 'em' || name === 'i') style.italic++;
        else if (name === 'h2' || name === 'h3' || name === 'h4') start(name);
        else if (name === 'p') {
          // A paragraph inside a list item continues that item.
          if (!(current && (current as Block).kind === 'li' && (current as Block).runs.length === 0)) start(quote ? 'quote' : 'p');
        } else if (name === 'ul' || name === 'ol') lists.push({ ordered: name === 'ol', n: 0 });
        else if (name === 'li') {
          const list = lists[lists.length - 1];
          if (list) list.n++;
          start('li', list?.ordered ? `${list.n}.` : '•');
        } else if (name === 'blockquote') quote++;
        else if (name === 'hr') {
          blocks.push({ kind: 'hr', runs: [], depth: 0 });
          end();
        } else if (name === 'br') {
          if (current) (current as Block).runs.push({ text: ' ' });
        }
      },
      ontext(text) {
        if (!text.trim() && !current) return;
        if (!current) start(quote ? 'quote' : 'p');
        (current as Block | null)?.runs.push({ text, bold: style.bold > 0, italic: style.italic > 0 });
      },
      onclosetag(name) {
        if (name === 'strong' || name === 'b') style.bold--;
        else if (name === 'em' || name === 'i') style.italic--;
        else if (['h2', 'h3', 'h4', 'p', 'li'].includes(name)) end();
        else if (name === 'ul' || name === 'ol') lists.pop();
        else if (name === 'blockquote') quote--;
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return blocks.filter((b) => b.kind === 'hr' || b.runs.some((r) => r.text.trim()));
}

function writeBlocks(w: Writer, blocks: Block[]) {
  for (const b of blocks) {
    if (b.kind === 'hr') w.rule();
    else if (b.kind === 'h2') w.heading(b.runs.map((r) => r.text).join(''), 14);
    else if (b.kind === 'h3') w.heading(b.runs.map((r) => r.text).join(''), 12);
    else if (b.kind === 'h4') w.heading(b.runs.map((r) => r.text).join(''), 11);
    else if (b.kind === 'li') {
      w.paragraph(b.runs, { indent: 16 * Math.max(1, b.depth), prefix: b.marker });
      w.gap(2);
    } else if (b.kind === 'quote') {
      w.paragraph(b.runs.map((r) => ({ ...r, italic: true })), { indent: 16, color: MUTED });
      w.gap(4);
    } else {
      w.paragraph(b.runs);
      w.gap(5);
    }
  }
}

// ---------- The document ----------

async function embedLogo(doc: PDFDocument, dataUrl: string | null): Promise<PDFImage | null> {
  const m = dataUrl ? /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl) : null;
  if (!m) return null;
  try {
    const bytes = Buffer.from(m[2], 'base64');
    return m[1].toLowerCase() === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    return null; // an unreadable logo never stops the agreement from being generated
  }
}

export async function buildAgreementPdf(input: AgreementPdfInput): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${input.title} – ${input.referenceNumber}`);
  doc.setAuthor(input.organisationName);
  doc.setCreator(input.organisationName);
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const brand = hexToRgb(input.primaryColor);
  const w = new Writer(doc, fonts, brand);

  // 1. Logo and title
  const logo = await embedLogo(doc, input.logoDataUrl);
  if (logo) {
    const h = 44;
    const scaled = logo.scale(h / logo.height);
    w.page.drawImage(logo, { x: MARGIN, y: w.y - h, width: Math.min(scaled.width, 180), height: h });
    w.gap(h + 10);
  }
  w.paragraph([{ text: input.organisationName, bold: true }], { size: 11, color: MUTED });
  w.paragraph([{ text: input.title, bold: true }], { size: 20, color: brand, lineGap: 1.3 });
  w.page.drawRectangle({ x: MARGIN, y: w.y - 4, width: w.width, height: 2, color: brand });
  w.gap(14);

  // 2. Reference number and agreement version
  w.keyValues([
    ['Agreement Reference No.', input.referenceNumber],
    ['Agreement Version', `Version ${input.agreementVersionNumber}`],
  ]);

  const d = input.details;
  // 3. Franchise details
  w.heading('Franchise Details');
  w.keyValues([
    ['Firm Name', d.firmName],
    ['Franchise Model', d.franchiseModel],
    ['Firm Type', d.firmType],
  ]);
  // 4. Official details
  w.heading('Official Details');
  w.keyValues([
    ['PAN Number', d.pan],
    ...(d.gst ? ([['GST Number', d.gst]] as [string, string][]) : []),
  ]);
  // 5. Applicant / Authorised Signatory
  w.heading('Applicant / Authorised Signatory');
  w.keyValues([
    ['Name', d.signatory.name],
    ['Capacity', d.signatory.capacity],
    ['Email', d.signatory.email],
    ['Mobile', `+91 ${d.signatory.mobile}`],
  ]);
  // 6. Contact persons
  w.heading('Contact Persons');
  w.table(
    ['#', 'Name', 'Mobile', 'Email'],
    [26, 150, 100, w.width - 276],
    d.contacts.map((c, i) => [String(i + 1), c.name, `+91 ${c.mobile}`, c.email]),
  );

  // 7. Agreement content
  if (input.content.format === 'text') {
    w.newPage();
    writeBlocks(w, htmlToBlocks(input.content.html));
  } else {
    // The uploaded PDF's pages, unchanged, scaled to fit A4 above the footer band.
    const source = await PDFDocument.load(input.content.bytes, { updateMetadata: false });
    const embedded = await doc.embedPages(source.getPages());
    for (const page of embedded) {
      const target = doc.addPage(A4);
      const scale = Math.min((A4[0] - 30) / page.width, (A4[1] - FOOTER_BAND - 20) / page.height);
      const width = page.width * scale;
      const height = page.height * scale;
      target.drawPage(page, { x: (A4[0] - width) / 2, y: FOOTER_BAND + (A4[1] - FOOTER_BAND - height) / 2, width, height });
    }
    w.newPage();
  }

  // 8 and 9. Acceptance record and dates
  w.heading('Acceptance and Approval Record');
  w.paragraph([{ text: `Accepted online by ${input.acceptedBy} on ${input.acceptedAt}.` }]);
  w.gap(6);
  w.keyValues([
    ['Manager approval date', input.approvedAt],
    ['Agreement generated on', input.generatedAt],
  ]);

  // Footer and page numbers on every page (PRD 9.3).
  const pages = doc.getPages();
  const footerSize = 8.5;
  pages.forEach((page, i) => {
    const { width } = page.getSize();
    page.drawRectangle({ x: 0, y: 0, width, height: FOOTER_BAND - 8, color: rgb(1, 1, 1) });
    page.drawLine({ start: { x: MARGIN, y: FOOTER_BAND - 12 }, end: { x: width - MARGIN, y: FOOTER_BAND - 12 }, thickness: 0.5, color: LINE });
    const footerWidth = fonts.italic.widthOfTextAtSize(AGREEMENT_PDF_FOOTER, footerSize);
    page.drawText(AGREEMENT_PDF_FOOTER, { x: (width - footerWidth) / 2, y: 28, size: footerSize, font: fonts.italic, color: MUTED });
    const label = `Page ${i + 1} of ${pages.length}`;
    const labelWidth = fonts.regular.widthOfTextAtSize(label, 8);
    page.drawText(label, { x: (width - labelWidth) / 2, y: 15, size: 8, font: fonts.regular, color: MUTED });
  });

  const bytes = await doc.save();
  return { bytes, pageCount: pages.length };
}
