import { useRef, useState } from "react";
import { ImagePlus, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fileToStudentPhoto } from "@/lib/image";

/// Editable student photo: a fixed passport-style frame with upload / remove
/// controls. The value is a base64 JPEG data URL (or "" when no photo).
export function StudentPhotoField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (photo: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setProcessing(true);
    try {
      onChange(await fileToStudentPhoto(file));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to add photo");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Photo</Label>
      <div className="flex items-start gap-4">
        <div className="flex aspect-[3/4] w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed bg-muted/30">
          {value ? (
            <img
              src={value}
              alt="Student"
              className="h-full w-full object-cover"
            />
          ) : (
            <User className="size-8 text-muted-foreground/60" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void handleFile(e.currentTarget.files?.[0]);
              // Allow re-selecting the same file after a remove.
              e.currentTarget.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || processing}
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus className="size-4" />
            {processing ? "Processing..." : value ? "Change photo" : "Add photo"}
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || processing}
              onClick={() => onChange("")}
            >
              <Trash2 className="size-4" />
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
