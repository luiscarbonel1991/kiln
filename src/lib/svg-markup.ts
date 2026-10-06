import { Fragment, isValidElement, type ReactNode } from "react";

// Static markup for the exact frames' SVG, without react-dom/server (Next does
// not allow it in server actions or route handlers). The frames are pure
// function components (no hooks, no context), so their element tree is walked
// and printed the way React prints it: the same attributes, styles and
// escaping (a parity test holds it to renderToStaticMarkup). `fonts` swaps the
// app's font variables for the family names a rasterizer knows.

export interface SvgMarkupOptions {
  fonts?: Record<string, string>;
}

// React props that print under another attribute name.
const ATTRIBUTE: Record<string, string> = {
  className: "class",
  strokeWidth: "stroke-width",
  strokeOpacity: "stroke-opacity",
  fillOpacity: "fill-opacity",
  textAnchor: "text-anchor",
  dominantBaseline: "dominant-baseline",
  xlinkHref: "xlink:href",
};

// Style properties whose numbers carry no unit (React's list, for those the
// frames can use).
const UNITLESS = new Set([
  "fontWeight",
  "opacity",
  "lineHeight",
  "fillOpacity",
  "strokeOpacity",
  "strokeWidth",
  "zIndex",
]);

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
};

export function escapeMarkup(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const hyphenate = (name: string) =>
  name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function styleMarkup(
  style: Record<string, unknown>,
  options: SvgMarkupOptions,
): string {
  return Object.entries(style)
    .filter(
      ([, v]) =>
        v !== null && v !== undefined && typeof v !== "boolean" && v !== "",
    )
    .map(([key, v]) => {
      let value =
        typeof v === "number" && v !== 0 && !UNITLESS.has(key)
          ? `${v}px`
          : String(v);
      if (key === "fontFamily" && options.fonts?.[value]) {
        value = options.fonts[value];
      }
      return `${hyphenate(key)}:${value}`;
    })
    .join(";");
}

function attributes(
  props: Record<string, unknown>,
  options: SvgMarkupOptions,
): string {
  return Object.entries(props)
    .filter(([key]) => key !== "children")
    .map(([key, value]) => {
      if (value === null || value === undefined || typeof value === "boolean") {
        return "";
      }
      if (key === "style" && typeof value === "object") {
        const css = styleMarkup(value as Record<string, unknown>, options);
        return css ? ` style="${escapeMarkup(css)}"` : "";
      }
      if (typeof value === "function" || typeof value === "object") return "";
      return ` ${ATTRIBUTE[key] ?? key}="${escapeMarkup(String(value))}"`;
    })
    .join("");
}

export function toSvgMarkup(
  node: ReactNode,
  options: SvgMarkupOptions = {},
): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return escapeMarkup(String(node));
  }
  if (Array.isArray(node)) {
    return node.map((child) => toSvgMarkup(child, options)).join("");
  }
  if (!isValidElement(node)) {
    throw new Error("toSvgMarkup: unsupported node");
  }
  const props = node.props as Record<string, unknown> & {
    children?: ReactNode;
  };
  if (node.type === Fragment) return toSvgMarkup(props.children, options);
  if (typeof node.type === "function") {
    const render = node.type as (p: unknown) => ReactNode;
    return toSvgMarkup(render(props), options);
  }
  if (typeof node.type !== "string") {
    throw new Error("toSvgMarkup: unsupported element type");
  }
  const tag = node.type;
  return `<${tag}${attributes(props, options)}>${toSvgMarkup(props.children, options)}</${tag}>`;
}
