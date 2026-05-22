import { useCallback, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { CloudUpload, FileText, Paperclip, X } from "lucide-react";

// Wire-format for a file attached to a message. Mirrors the server API
// payload: `data` is either the raw UTF-8 text (when `isBase64Encoded` is
// false) or a base64-encoded byte string. `size` is carried for UI display
// only and is not sent to the server.
export type FileAttachment = {
  name: string;
  type: string;
  data: string;
  isBase64Encoded: boolean;
  size: number;
};

// 5 MB cap to keep request bodies sane and the browser responsive. Files this
// large already make for a slow paste into the agent context anyway.
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "xml", "yaml", "yml",
  "toml", "ini", "conf", "env", "log", "html", "htm", "css", "scss", "sass",
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "py", "rb", "go", "rs", "java",
  "kt", "c", "h", "cc", "cpp", "hpp", "cs", "php", "sh", "bash", "zsh",
  "fish", "ps1", "sql", "graphql", "gql", "proto", "svg",
]);

function isTextFile(file: File): boolean {
  const t = file.type;
  if (t.startsWith("text/")) return true;
  if (
    t === "application/json" ||
    t === "application/ld+json" ||
    t === "application/xml" ||
    t === "application/xhtml+xml" ||
    t === "application/yaml" ||
    t === "application/x-yaml" ||
    t === "application/javascript" ||
    t === "application/typescript" ||
    t === "image/svg+xml"
  ) {
    return true;
  }
  const dot = file.name.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_EXTENSIONS.has(file.name.slice(dot + 1).toLowerCase());
}

function bufferToBase64(buffer: ArrayBuffer): string {
  // btoa accepts a "binary string" — one char per byte. We chunk to avoid
  // blowing the call-stack on large arrays.
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function readFileAsAttachment(file: File): Promise<FileAttachment> {
  if (isTextFile(file)) {
    const data = await file.text();
    return {
      name: file.name,
      type: file.type || "text/plain",
      data,
      isBase64Encoded: false,
      size: file.size,
    };
  }
  const buf = await file.arrayBuffer();
  return {
    name: file.name,
    type: file.type || "application/octet-stream",
    data: bufferToBase64(buf),
    isBase64Encoded: true,
    size: file.size,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

// Pill rendered above the textarea once a file is attached.
export function AttachmentPill({
  attachment,
  onRemove,
}: {
  attachment: FileAttachment;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-xl text-sm">
      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="flex-1 truncate text-foreground">{attachment.name}</span>
      <span className="text-xs text-muted-foreground shrink-0">
        {formatBytes(attachment.size)}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${attachment.name}`}
        className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// Compact chip used inside the user message bubble so the chat history shows
// what was sent alongside the text. Read-only, no remove button.
// `size` is optional because messages loaded from server history may not carry
// it — the chip just omits the size in that case.
export function AttachmentChip({
  attachment,
}: {
  attachment: { name: string; size?: number };
}) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 bg-background/60 border border-border rounded-lg text-xs">
      <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <span className="truncate max-w-[200px] text-foreground">{attachment.name}</span>
      {typeof attachment.size === "number" && (
        <span className="text-muted-foreground shrink-0">{formatBytes(attachment.size)}</span>
      )}
    </div>
  );
}

// Trigger button — matches the visual weight of the existing mic button.
export function AttachButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Attach file"
      aria-label="Attach file"
      className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
    >
      <Paperclip className="w-4 h-4" />
    </button>
  );
}

export function FileAttachModal({
  open,
  onOpenChange,
  onAttach,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAttach: (attachments: FileAttachment[]) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: File[]) => {
      setError(null);
      if (files.length === 0) return;
      const oversize = files.find((f) => f.size > MAX_FILE_BYTES);
      if (oversize) {
        setError(
          `"${oversize.name}" is too large (max ${formatBytes(MAX_FILE_BYTES)}).`,
        );
        return;
      }
      setBusy(true);
      try {
        const attachments = await Promise.all(files.map(readFileAsAttachment));
        onAttach(attachments);
        onOpenChange(false);
      } catch {
        setError("Could not read one of the files. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [onAttach, onOpenChange],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) handleFiles(files);
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) handleFiles(files);
    // Reset so picking the same file twice still fires onChange.
    e.target.value = "";
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          setIsDragging(false);
        }
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-md bg-card border border-border rounded-xl shadow-xl p-6 data-[state=open]:animate-in data-[state=open]:zoom-in-95 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=closed]:fade-out-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                Attach file
              </Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground mt-1">
                Drop a file below or browse from your computer. Up to{" "}
                {formatBytes(MAX_FILE_BYTES)}.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            disabled={busy}
            className={`w-full flex flex-col items-center justify-center gap-3 px-6 py-10 rounded-xl border-2 border-dashed transition-colors text-center ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary hover:bg-muted/50"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <CloudUpload className="w-8 h-8 text-muted-foreground" />
            <div className="text-sm text-foreground">
              {busy
                ? "Reading file…"
                : isDragging
                  ? "Drop to attach"
                  : "Drag and drop, or click to browse"}
            </div>
            <div className="text-xs text-muted-foreground">
              Text files are sent as-is; binary files are base64-encoded.
            </div>
          </button>

          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onPickFile}
          />

          {error && (
            <p role="alert" className="mt-3 text-xs text-destructive">
              {error}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
