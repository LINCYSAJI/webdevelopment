import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

type Pdfjs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<Pdfjs> | null = null;

/** Loads the PDF library only when a PDF is actually shown, keeping other pages fast. */
function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return pdfjsPromise;
}

interface PdfViewerProps {
  /** Address of the PDF on our API. */
  url: string;
  /** Height of the scrollable panel (Tailwind class). */
  heightClass?: string;
  /** Text read out to screen readers. */
  label?: string;
}

/**
 * Shows a PDF as page images inside a scrollable panel. Drawing the pages ourselves works on
 * every phone and computer; many mobile browsers cannot show a PDF inside a page.
 */
export function PdfViewer({ url, heightClass = 'h-[70vh]', label = 'Agreement document' }: PdfViewerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    setDoc(null);
    setFailed(false);
    loadPdfjs()
      .then((pdfjs) => {
        if (cancelled) return null;
        const task = pdfjs.getDocument({ url, withCredentials: true, enableXfa: false });
        destroy = () => void task.destroy();
        return task.promise;
      })
      .then((d) => {
        if (d && !cancelled) setDoc(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [url]);

  // Re-draw pages at the panel's width, so text stays sharp on phones and large screens.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    let timer: number | undefined;
    const observer = new ResizeObserver(([entry]) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setWidth(Math.floor(entry.contentRect.width)), 150);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div>
      <div
        ref={panelRef}
        role="document"
        aria-label={label}
        tabIndex={0}
        className={`${heightClass} overflow-y-auto rounded-md border border-slate-300 bg-slate-100 p-2 sm:p-3`}
      >
        {failed ? (
          <p className="p-4 text-center text-sm text-slate-700">
            The agreement could not be shown here. Please use <strong>Open in new tab</strong> below to read it.
          </p>
        ) : !doc || !width ? (
          <p className="p-4 text-center text-sm text-slate-500">Loading the agreement…</p>
        ) : (
          <div className="space-y-3">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage key={i} doc={doc} pageNumber={i + 1} width={width - 2} />
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <span>{doc ? `${doc.numPages} page${doc.numPages === 1 ? '' : 's'} · scroll to read all pages` : ''}</span>
        <span className="flex gap-3">
          <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">
            Open in new tab
          </a>
          <a href={`${url}${url.includes('?') ? '&' : '?'}download=1`} className="font-medium text-brand hover:underline">
            Download
          </a>
        </span>
      </div>
    </div>
  );
}

function PdfPage({ doc, pageNumber, width }: { doc: PDFDocumentProxy; pageNumber: number; width: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let cancelRender: (() => void) | null = null;
    doc
      .getPage(pageNumber)
      .then((page) => {
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        const base = page.getViewport({ scale: 1 });
        const scale = width / base.width;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: scale * ratio });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        setHeight(Math.floor(base.height * scale));
        const task = page.render({ canvas, viewport });
        cancelRender = () => task.cancel();
        return task.promise;
      })
      .catch(() => {
        /* a cancelled render (e.g. on resize) is expected */
      });
    return () => {
      cancelled = true;
      cancelRender?.();
    };
  }, [doc, pageNumber, width]);

  return (
    <canvas
      ref={canvasRef}
      aria-label={`Page ${pageNumber}`}
      className="mx-auto block bg-white shadow-sm"
      style={{ width, height: height ?? Math.round(width * 1.414) }}
    />
  );
}
