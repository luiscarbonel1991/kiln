import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Kiln is driven by agents and test runners as much as by hands (ROADMAP
// P2-10, DOGFOOD #71): every control has a stable data-testid and a name an
// accessibility tree can read. Read from the source: a button, a field, a
// menu item or a toggle in the app's components and pages. The primitives
// in components/ui pass their props through.
const root = join(import.meta.dirname, "..", "..");
const SKIP = new Set(["__tests__", "ui"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return SKIP.has(name) ? [] : sources(path);
    }
    return path.endsWith(".tsx") ? [path] : [];
  });
}

const CLICKABLE = new Set([
  "button",
  "Button",
  "DropdownMenu.Item",
  "ToggleGroup.Item",
]);
const FIELDS = new Set(["input", "select", "textarea"]);

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

const attribute = (el: Opening, name: string) =>
  el.attributes.properties.find(
    (p): p is ts.JsxAttribute =>
      ts.isJsxAttribute(p) && p.name.getText() === name,
  );
const spreads = (el: Opening) =>
  el.attributes.properties.some((p) => ts.isJsxSpreadAttribute(p));

// Whether a node may render text: written text, or any value but markup
// (an icon component, null, a JSX branch with no text).
function mayRenderText(node: ts.Node): boolean {
  if (ts.isJsxText(node)) return /\S/.test(node.getText());
  if (ts.isJsxSelfClosingElement(node)) return false;
  if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
    return node.children.some(mayRenderText);
  }
  if (ts.isJsxExpression(node)) {
    return node.expression ? mayRenderText(node.expression) : false;
  }
  if (ts.isParenthesizedExpression(node)) return mayRenderText(node.expression);
  if (ts.isConditionalExpression(node)) {
    return mayRenderText(node.whenTrue) || mayRenderText(node.whenFalse);
  }
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return mayRenderText(node.right);
  }
  return node.kind !== ts.SyntaxKind.NullKeyword;
}

const NAMED_BY = ["aria-label", "aria-labelledby", "title"];

function insideLabel(node: ts.Node): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxElement(p) && p.openingElement.tagName.getText() === "label") {
      return true;
    }
  }
  return false;
}

interface Problem {
  at: string;
  tag: string;
  missing: string[];
}

function problems(path: string): Problem[] {
  const text = readFileSync(path, "utf8");
  const file = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: Problem[] = [];
  const visit = (node: ts.Node) => {
    const el = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    if (el) {
      const tag = el.tagName.getText();
      const type = attribute(el, "type")?.initializer?.getText();
      const control =
        CLICKABLE.has(tag) || (FIELDS.has(tag) && type !== '"hidden"');
      if (control && !spreads(el)) {
        const missing: string[] = [];
        if (!attribute(el, "data-testid")) missing.push("data-testid");
        const named = NAMED_BY.some((n) => attribute(el, n));
        if (CLICKABLE.has(tag)) {
          const text = ts.isJsxElement(node)
            ? node.children.some(mayRenderText)
            : false;
          if (!named && !text) missing.push("name");
        } else if (!named && !attribute(el, "id") && !insideLabel(node)) {
          missing.push("name");
        }
        if (missing.length > 0) {
          const { line } = file.getLineAndCharacterOfPosition(el.getStart());
          found.push({
            at: `${relative(root, path)}:${line + 1}`,
            tag,
            missing,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("agent-ready controls", () => {
  it("every control has a data-testid and a name", () => {
    const files = [
      ...sources(join(root, "components")),
      ...sources(join(root, "app")),
    ];
    expect(files.length).toBeGreaterThan(40);
    const all = files.flatMap(problems);
    expect(
      all.map((p) => `${p.at} <${p.tag}> needs ${p.missing.join(" and ")}`),
    ).toEqual([]);
  });

  // A route's loading.tsx streams its page behind Suspense, and React reveals
  // streamed content on the next animation frame. A browser pane that paints
  // no frames (an agent's hidden pane) kept the board on "Loading…", its
  // controls hidden and never hydrated, so every click did nothing (DOGFOOD
  // #71, #73).
  it("no page waits behind a loading file", () => {
    const loading = sources(join(root, "app")).filter((path) =>
      path.endsWith("loading.tsx"),
    );
    expect(loading.map((path) => relative(root, path))).toEqual([]);
  });
});
