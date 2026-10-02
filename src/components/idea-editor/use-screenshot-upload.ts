import { useCallback, useEffect, useState } from "react";

/**
 * Screenshot upload state for the editor: file picker / paste / drag & drop → POST /api/uploads → `onAdd(fileName)`.
 * `onAdd` and `onError` must be stable (state setters or useCallback).
 */
export function useScreenshotUpload(onAdd: (fileName: string) => void, onError: (message: string) => void) {
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const upload = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (files.length && !images.length) {
        onError("Only images can be attached (PNG, JPG, WEBP, GIF)");
        return;
      }
      if (!images.length) return;
      setUploading((n) => n + images.length);
      for (const file of images) {
        try {
          if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name || "Image"} is larger than 10 MB`);
          const body = new FormData();
          body.append("file", file);
          const res = await fetch("/api/uploads", { method: "POST", body });
          const json = (await res.json().catch(() => ({}))) as { fileName?: string; error?: string };
          if (!res.ok || !json.fileName) throw new Error(json.error ?? `Upload failed (${res.status})`);
          onAdd(json.fileName);
        } catch (e) {
          onError(e instanceof Error ? e.message : "Upload failed");
        } finally {
          setUploading((n) => n - 1);
        }
      }
    },
    [onAdd, onError],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        void upload(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [upload]);

  /** Spread on the element that should accept dropped files. */
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if ([...e.dataTransfer.types].includes("Files")) {
        e.preventDefault();
        setDragOver(true);
      }
    },
    onDragLeave: () => setDragOver(false),
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      setDragOver(false);
      void upload([...e.dataTransfer.files]);
    },
  };

  return { uploading, dragOver, upload, dropProps };
}
