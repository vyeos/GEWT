import { useEffect, useState, type ReactNode } from "react";
import { LETTERHEAD_FALLBACK, letterheadSrc } from "@/lib/letterhead";
import { cn } from "@/lib/utils";
import type { Course } from "@/types";

/**
 * A single A4 print page that renders the course letterhead as a full-bleed
 * background (header at the very top, footer at the very bottom, both spanning
 * the full page width) and lays the document content into the blank middle.
 *
 * Letterhead artwork is a complete A4 page (1414x2000 ≈ the 210x297mm A4 ratio),
 * so it fills the page exactly. Across every letterhead the header graphic ends
 * by ~21% of the page height and the footer begins by ~85%, so the content zone
 * (top 23% / bottom 17%) clears both with margin to spare. See the letterhead
 * measurements in lib/letterhead.ts notes.
 */
export function PrintPage({
  letterhead,
  contentClassName,
  children,
}: {
  letterhead: Course["letterhead"] | undefined;
  contentClassName?: string;
  children: ReactNode;
}) {
  const [usingFallback, setUsingFallback] = useState(!letterhead);

  useEffect(() => {
    setUsingFallback(!letterhead);
  }, [letterhead]);

  return (
    <div className="relative h-[297mm] w-[210mm] overflow-hidden bg-white font-['Geist',Arial,sans-serif] text-black">
      <img
        src={letterheadSrc(letterhead)}
        alt=""
        // Fill the page exactly. No bleed: any overflow past 297mm makes WebKit's
        // print engine fragment the oversized box onto a blank 2nd page (the
        // page box is clamped to A4 in App.css, so the four edges already meet it).
        className={cn(
          "absolute inset-0 h-full w-full object-fill",
          usingFallback && "opacity-5",
        )}
        onError={(e) => {
          if (e.currentTarget.src.endsWith(LETTERHEAD_FALLBACK)) return;
          setUsingFallback(true);
          e.currentTarget.src = LETTERHEAD_FALLBACK;
        }}
      />
      <div
        className={cn(
          "absolute inset-x-[8%] top-[23%] bottom-[17%] flex flex-col text-[15px]",
          contentClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
