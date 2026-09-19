import { useRef, useState } from "react";
import { Camera, X, Loader2 } from "lucide-react";

interface Props {
  label: string;
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  testId: string;
  required?: boolean;
}

const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.6;

async function fileToCompressedDataUrl(file: File): Promise<string> {
  const reader = new FileReader();
  const original: string = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
  if (!original.startsWith("data:image/")) return original;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = original;
  });
  let { width, height } = img;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return original;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

export default function PhotoCapture({ label, value, onChange, testId, required }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await fileToCompressedDataUrl(file);
      onChange(dataUrl);
    } catch {
      onChange(null);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <label className="text-xs font-medium text-text-tertiary mb-1.5 block">
        <Camera className="w-3.5 h-3.5 inline mr-1" />
        {label}{required ? " *" : ""}
      </label>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFile}
        className="hidden"
        data-testid={`${testId}-input`}
      />
      {value ? (
        <div className="relative rounded-lg overflow-hidden border border-hairline" style={{ background: "hsl(var(--v7-surface-overlay) / 0.4)" }}>
          <img src={value} alt={label} className="w-full max-h-48 object-contain" data-testid={`${testId}-preview`} />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 text-text-primary"
            data-testid={`${testId}-clear`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="w-full h-24 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1.5 active:scale-[0.99] disabled:opacity-50"
          style={{ borderColor: "hsl(var(--v7-border-hairline))", background: "hsl(var(--v7-surface-overlay) / 0.3)" }}
          data-testid={`${testId}-trigger`}
        >
          {busy ? (
            <Loader2 className="w-5 h-5 text-jacaranda-400 animate-spin" />
          ) : (
            <>
              <Camera className="w-5 h-5 text-jacaranda-400" />
              <span className="text-xs text-text-tertiary">Tap to take photo</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
