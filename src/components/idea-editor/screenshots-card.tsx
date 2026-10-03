import { AlertTriangle, ImagePlus, Loader2, X } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/cn";
import type { EditorAttachment } from "@/lib/editor-shape";
import { Button, Card, CardHeader, Select } from "../ui";

export function ScreenshotsCard({
  attachments,
  onChange,
  upload,
  uploading,
  uploadError,
  dragOver,
}: {
  attachments: EditorAttachment[];
  onChange: (next: EditorAttachment[]) => void;
  upload: (files: File[]) => void;
  uploading: number;
  /** The server's reason a file was rejected (wrong type, too large, ...). */
  uploadError?: string | null;
  dragOver: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const patch = (key: string, p: Partial<EditorAttachment>) => onChange(attachments.map((x) => (x.key === key ? { ...x, ...p } : x)));
  return (
    <Card className={cn(dragOver && "border-accent ring-2 ring-accent/30")}>
      <CardHeader
        title="Screenshots"
        description="Paste (⌘V), drag & drop, or browse. Before / during / after."
        action={
          <Button size="sm" onClick={() => fileInput.current?.click()}>
            <ImagePlus className="h-3.5 w-3.5" /> Add
          </Button>
        }
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        aria-label="Add screenshots"
        onChange={(e) => {
          upload([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {uploadError && (
        <p role="alert" className="mx-4 mb-3 flex items-center gap-1.5 text-sm text-loss">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {uploadError}
        </p>
      )}
      <div className="grid grid-cols-3 gap-3 px-4 pb-4">
        {attachments.map((a) => (
          <div key={a.key} className="overflow-hidden rounded-lg border border-line bg-panel-2">
            <div className="relative aspect-video bg-black/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/uploads/${a.filePath}`} alt={a.caption || "Screenshot"} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => onChange(attachments.filter((x) => x.key !== a.key))}
                className="absolute top-1 right-1 rounded-md bg-black/70 p-1 text-white hover:bg-rose-600"
                aria-label="Remove screenshot"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-1.5 p-2">
              <Select
                value={a.kind}
                aria-label="When was this screenshot taken"
                onChange={(e) => patch(a.key, { kind: e.target.value as EditorAttachment["kind"] })}
                size="sm"
              >
                <option value="before">Before</option>
                <option value="during">During</option>
                <option value="after">After</option>
              </Select>
              <input
                value={a.caption}
                placeholder="Caption"
                aria-label="Caption"
                onChange={(e) => patch(a.key, { caption: e.target.value })}
                className="w-full rounded border border-line bg-panel px-1.5 py-1 text-xs"
              />
            </div>
          </div>
        ))}
        {uploading > 0 && (
          <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted">
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Uploading…
          </div>
        )}
        {!attachments.length && !uploading && (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="col-span-full flex h-24 items-center justify-center rounded-lg border border-dashed border-line text-sm text-faint hover:border-line-strong hover:text-muted"
          >
            Paste a chart screenshot here
          </button>
        )}
      </div>
    </Card>
  );
}
