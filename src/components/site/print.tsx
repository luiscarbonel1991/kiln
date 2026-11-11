import type { CSSProperties, ReactNode } from "react";

// A print on paper: the image, a white border, and what it is written on the
// wider bottom edge. `tone` colours the second line: free, paid or failed.
export function Print({
  children,
  marks,
  title,
  note,
  tone = "plain",
  tilt = 0,
  className,
  style,
}: {
  children: ReactNode;
  // Drawn over the whole print, free to overhang its edge.
  marks?: ReactNode;
  title?: ReactNode;
  note?: ReactNode;
  tone?: "free" | "paid" | "failed" | "plain";
  tilt?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <figure
      className={`print ${className ?? ""}`}
      data-tone={tone}
      style={{ ...style, "--tilt": `${tilt}deg` } as CSSProperties}
    >
      <div className="print-art">{children}</div>
      {marks}
      {title || note ? (
        <figcaption>
          {title ? <b>{title}</b> : null}
          {note ? <span>{note}</span> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
