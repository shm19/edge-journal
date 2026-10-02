"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export interface GalleryImage {
  src: string;
  caption?: string;
  label?: string;
  href?: string;
}

export function Gallery({ images, columns = "grid-cols-2 sm:grid-cols-3" }: { images: GalleryImage[]; columns?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const step = useCallback((d: number) => setOpen((i) => (i == null ? i : (i + d + images.length) % images.length)), [images.length]);

  useEffect(() => {
    if (open == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, step]);

  if (!images.length) return <p className="text-sm text-faint">No screenshots.</p>;
  const cur = open != null ? images[open] : null;

  return (
    <>
      <div className={`grid gap-3 ${columns}`}>
        {images.map((img, i) => (
          <button
            type="button"
            key={img.src + i}
            onClick={() => setOpen(i)}
            className="group overflow-hidden rounded-lg border border-line bg-panel-2 text-left"
          >
            <div className="aspect-video overflow-hidden bg-black/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.src} alt={img.caption || "Screenshot"} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
            </div>
            {(img.label || img.caption) && (
              <div className="px-2 py-1.5 text-xs">
                {img.label && <span className="mr-1.5 font-medium text-muted">{img.label}</span>}
                <span className="text-faint">{img.caption}</span>
              </div>
            )}
          </button>
        ))}
      </div>
      {cur && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={close} role="dialog" aria-modal>
          <button className="absolute top-4 right-4 rounded-md p-2 text-white/80 hover:bg-white/10" onClick={close} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
          {images.length > 1 && (
            <>
              <button
                className="absolute left-3 rounded-md p-2 text-white/80 hover:bg-white/10"
                onClick={(e) => {
                  e.stopPropagation();
                  step(-1);
                }}
                aria-label="Previous"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                className="absolute right-3 rounded-md p-2 text-white/80 hover:bg-white/10"
                onClick={(e) => {
                  e.stopPropagation();
                  step(1);
                }}
                aria-label="Next"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
          <figure className="max-h-full max-w-6xl" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cur.src} alt={cur.caption || "Screenshot"} className="max-h-[85vh] w-auto rounded-lg object-contain" />
            <figcaption className="mt-2 text-center text-sm text-white/70">
              {cur.label && <span className="mr-2 font-medium">{cur.label}</span>}
              {cur.caption}
              {cur.href && (
                <a href={cur.href} className="ml-2 text-accent underline">
                  Open idea →
                </a>
              )}
            </figcaption>
          </figure>
        </div>
      )}
    </>
  );
}
