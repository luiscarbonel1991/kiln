import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Two studios on one Kiln never see each other's work: every query of a
// maker's data names the maker (security.md). Read from the source: the
// schema says which models belong to a maker, and a repository function that
// queries one without naming the maker fails here, as does a query written
// where this check cannot see it.
const root = join(import.meta.dirname, "..", "..", "..");
const SCHEMA = "prisma/schema.prisma";
const posix = (path: string) => path.split(sep).join("/");

// ---- The schema: which models belong to a maker ----

interface Models {
  // Models with a makerId column.
  withMakerId: string[];
  // Models with none, reached only through a required parent that has one.
  children: string[];
  // Both, and Maker itself.
  all: string[];
  // Per model, its relation fields that lead to a model with makerId.
  joins: Record<string, Record<string, string>>;
}

interface ModelBlock {
  name: string;
  fields: { name: string; type: string; optional: boolean; rest: string }[];
  body: string;
}

function modelBlocks(schemaText: string): ModelBlock[] {
  const text = schemaText.replace(/\/\/.*$/gm, "");
  return [...text.matchAll(/^model\s+(\w+)\s*\{\n([\s\S]*?)^\}/gm)].map(
    ([, name, body]) => ({
      name,
      body,
      fields: body.split("\n").flatMap((line) => {
        const field = line.match(/^\s*(\w+)\s+(\w+)(\?|\[\])?(.*)$/);
        return field
          ? [
              {
                name: field[1],
                type: field[2],
                optional: field[3] !== undefined,
                rest: field[4],
              },
            ]
          : [];
      }),
    }),
  );
}

function makerOwnedModels(schemaText: string): Models {
  const blocks = modelBlocks(schemaText);
  const withMakerId = blocks
    .filter((m) => m.fields.some((f) => f.name === "makerId"))
    .map((m) => m.name);
  const owned = new Set(withMakerId);
  const owning = (f: ModelBlock["fields"][number]) =>
    owned.has(f.type) && /@relation\(\s*fields:/.test(f.rest);
  const children = blocks
    .filter(
      (m) =>
        !owned.has(m.name) &&
        m.name !== "Maker" &&
        m.fields.some((f) => owning(f) && !f.optional),
    )
    .map((m) => m.name);
  const joins: Models["joins"] = {};
  for (const m of blocks) {
    joins[m.name] = Object.fromEntries(
      m.fields.filter(owning).map((f) => [f.name, f.type]),
    );
  }
  const maker = blocks.some((m) => m.name === "Maker") ? ["Maker"] : [];
  return {
    withMakerId,
    children,
    all: [...withMakerId, ...children, ...maker],
    joins,
  };
}

// The models that have a makerId column and no index starting with it.
function unindexed(schemaText: string): string[] {
  return modelBlocks(schemaText)
    .filter((m) => {
      const field = m.fields.find((f) => f.name === "makerId");
      if (!field) return false;
      return !(
        /@(unique|id)\b/.test(field.rest) ||
        /@@(index|unique|id)\(\s*(fields:\s*)?\[\s*makerId\b/.test(m.body)
      );
    })
    .map((m) => m.name);
}

const noIndex = (model: string) =>
  `${SCHEMA} ${model}: has makerId but no index starting with it. Add @@index([makerId]) in a migration, or list it in UNINDEXED with the follow-up issue.`;

// ---- The source: where the queries are ----

const BY_KEY = [
  "findUnique",
  "findUniqueOrThrow",
  "update",
  "delete",
  "upsert",
];
const LISTS = [
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "groupBy",
  "aggregate",
  "updateMany",
  "deleteMany",
];
// Prisma's types refuse a create on these models without its maker.
const CREATES = ["create", "createMany", "createManyAndReturn"];
const CHECKED = new Set([...BY_KEY, ...LISTS]);
const PRISMA = new Set([...BY_KEY, ...LISTS, ...CREATES]);

interface Query {
  node: ts.Node;
  pos: number;
  line: number;
  // The models it reads or writes (a raw query may name several tables).
  models: string[];
  call: { property: string; method: string; args: ts.Expression | null } | null;
  raw: ts.TemplateLiteral | null;
}

type Shape = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

interface RepositoryFunction {
  name: string;
  fn: Shape;
  queries: Query[];
}

interface Scan {
  functions: RepositoryFunction[];
  outside: Query[];
}

function parse(sourceText: string, path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

const isRawName = (name: string) => /^\$(queryRaw|executeRaw)/.test(name);

function scan(sourceText: string, path: string, models: Models): Scan {
  const file = parse(sourceText, path);
  const client = new Map(
    models.all.map((m) => [m[0].toLowerCase() + m.slice(1), m]),
  );
  const tables = (text: string) => [
    ...new Set(
      [...text.matchAll(/"([A-Z]\w*)"/g)]
        .map((m) => m[1])
        .filter((name) => models.all.includes(name)),
    ),
  ];
  const queries: Query[] = [];
  const at = (node: ts.Node) => ({
    node,
    pos: node.getStart(file),
    line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
  });
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const method = node.expression.name.text;
      const target = node.expression.expression;
      if (PRISMA.has(method) && ts.isPropertyAccessExpression(target)) {
        const model = client.get(target.name.text);
        if (model) {
          queries.push({
            ...at(node),
            models: [model],
            call: {
              property: target.name.text,
              method,
              args: node.arguments[0] ?? null,
            },
            raw: null,
          });
        }
      } else if (isRawName(method)) {
        const named = tables(node.arguments.map((a) => a.getText()).join(" "));
        if (named.length > 0) {
          queries.push({ ...at(node), models: named, call: null, raw: null });
        }
      }
    }
    if (
      ts.isTaggedTemplateExpression(node) &&
      ts.isPropertyAccessExpression(node.tag) &&
      isRawName(node.tag.name.text)
    ) {
      const named = tables(node.template.getText());
      if (named.length > 0) {
        queries.push({
          ...at(node),
          models: named,
          call: null,
          raw: node.template,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  // The shapes the scope check reads: a top-level function declaration, or a
  // top-level const whose value is the function itself (not a call around it).
  const shapes: { name: string; fn: Shape }[] = [];
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.body) {
      shapes.push({ name: statement.name?.text ?? "default", fn: statement });
    }
    if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(d.name) &&
          d.initializer &&
          (ts.isArrowFunction(d.initializer) ||
            ts.isFunctionExpression(d.initializer))
        ) {
          shapes.push({ name: d.name.text, fn: d.initializer });
        }
      }
    }
  }
  const inside = (q: Query, fn: Shape) =>
    q.pos >= fn.getStart(file) && q.pos < fn.getEnd();
  return {
    functions: shapes
      .map((s) => ({ ...s, queries: queries.filter((q) => inside(q, s.fn)) }))
      .filter((s) => s.queries.length > 0),
    outside: queries.filter((q) => !shapes.some((s) => inside(q, s.fn))),
  };
}

type Listed = { has(key: string): boolean };

interface ScopeOptions {
  models: Models;
  // "<path> <function>" of the functions that work without a maker by design.
  unscoped?: Listed;
  // "<path> <function>" of the functions scoped by a makerId string.
  makerIdFirst?: Listed;
}

const flat = (node: ts.Node) => node.getText().replace(/\s+/g, "");

function unwrap(node: ts.Expression): ts.Expression {
  let inner = node;
  while (
    ts.isParenthesizedExpression(inner) ||
    ts.isAsExpression(inner) ||
    ts.isSatisfiesExpression(inner)
  ) {
    inner = inner.expression;
  }
  return inner;
}

// The lines a developer reads for one file: each repository function that
// queries a maker's data without naming the maker.
function unscoped(
  sourceText: string,
  path: string,
  options: ScopeOptions,
): string[] {
  const { models } = options;
  const children = new Set(models.children);
  return scan(sourceText, path, models).functions.flatMap((f) => {
    const key = `${path} ${f.name}`;
    if (options.unscoped?.has(key)) return [];
    const byMakerId = options.makerIdFirst?.has(key) ?? false;
    const first = f.fn.parameters[0];
    const makerFirst =
      first !== undefined &&
      ts.isIdentifier(first.name) &&
      first.name.text === "maker" &&
      first.type !== undefined &&
      /^(MakerRef|CurrentMaker)$/.test(first.type.getText());
    let usesMaker = false;
    const constants = new Map<string, ts.ObjectLiteralExpression>();
    const read = (node: ts.Node) => {
      if (ts.isIdentifier(node) && node.text === "maker" && makerFirst) {
        const p = node.parent;
        const isName =
          (ts.isPropertyAccessExpression(p) && p.name === node) ||
          (ts.isPropertyAssignment(p) && p.name === node) ||
          (ts.isParameter(p) && p.name === node);
        if (!isName) usesMaker = true;
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (node.parent.flags & ts.NodeFlags.Const) !== 0
      ) {
        const value = unwrap(node.initializer);
        if (ts.isObjectLiteralExpression(value)) {
          constants.set(node.name.text, value);
        }
      }
      ts.forEachChild(node, read);
    };
    if (f.fn.body) read(f.fn.body);

    // An expression that is the maker's id, as this function holds it.
    const isMakerId = (node: ts.Expression) => {
      const text = flat(node);
      if (makerFirst && text === "maker.id") return true;
      return (
        byMakerId &&
        (text === "makerId" ||
          text === "maker.id" ||
          /\.makerId$/.test(text) ||
          /\.maker\.id$/.test(text))
      );
    };
    const names = (where: ts.ObjectLiteralExpression, model: string): boolean =>
      where.properties.some((p) => {
        if (ts.isShorthandPropertyAssignment(p)) {
          return p.name.text === "makerId" && !children.has(model) && byMakerId;
        }
        if (!ts.isPropertyAssignment(p)) return false;
        const name = ts.isIdentifier(p.name) ? p.name.text : "";
        const value = unwrap(p.initializer);
        if (!children.has(model)) {
          if (name === (model === "Maker" ? "id" : "makerId")) {
            return isMakerId(value);
          }
          if (name.startsWith("makerId_")) {
            return ts.isObjectLiteralExpression(value) && names(value, model);
          }
        }
        const parent = models.joins[model]?.[name];
        return (
          parent !== undefined &&
          ts.isObjectLiteralExpression(value) &&
          names(value, parent)
        );
      });
    const whereOf = (
      args: ts.Expression | null,
    ): ts.ObjectLiteralExpression | null => {
      if (!args || !ts.isObjectLiteralExpression(args)) return null;
      for (const p of args.properties) {
        if (ts.isShorthandPropertyAssignment(p) && p.name.text === "where") {
          return constants.get("where") ?? null;
        }
        if (
          ts.isPropertyAssignment(p) &&
          ts.isIdentifier(p.name) &&
          p.name.text === "where"
        ) {
          const value = unwrap(p.initializer);
          if (ts.isObjectLiteralExpression(value)) return value;
          if (ts.isIdentifier(value)) return constants.get(value.text) ?? null;
          return null;
        }
      }
      return null;
    };
    const rawNames = (template: ts.TemplateLiteral): boolean => {
      if (!ts.isTemplateExpression(template)) return false;
      let before = template.head.text;
      for (const span of template.templateSpans) {
        if (
          (/"makerId"\s*=\s*$/.test(before) ||
            /"Maker"\s+WHERE\s+"id"\s*=\s*$/.test(before)) &&
          isMakerId(span.expression)
        ) {
          return true;
        }
        before = span.literal.text;
      }
      return false;
    };
    const scoped = (q: Query) => {
      if (q.raw) return rawNames(q.raw);
      if (!q.call || !CHECKED.has(q.call.method)) return false;
      const where = whereOf(q.call.args);
      return where !== null && names(where, q.models[0]);
    };

    const ordered = [...f.queries].sort((a, b) => a.pos - b.pos);
    const hits: string[] = [];
    let excused = false;
    for (const q of ordered) {
      const named = scoped(q);
      if (q.call && CHECKED.has(q.call.method) && !named && !excused) {
        const model = q.models[0];
        const how = children.has(model)
          ? `Join its where through the parent (project: { makerId: maker.id })`
          : `Add makerId: maker.id to its where`;
        hits.push(
          `${path} ${f.name}: ${q.call.property}.${q.call.method} at line ${q.line} queries ${model} with a where that names no maker. ${how}, or read the row under its maker first.`,
        );
      }
      if (named) excused = true;
    }
    const without = `${path} ${f.name}: queries ${ordered[0].models[0]} without a maker. Take maker: MakerRef first and filter by makerId: maker.id, or list it in UNSCOPED with the reason.`;
    if (!makerFirst && !byMakerId) return [without];
    if (hits.length > 0) return hits;
    return makerFirst && !usesMaker ? [without] : [];
  });
}

// The queries the scope check cannot see: in a wrapped const, a tool's
// definition, a method, or at the top of the module.
function outsideShapes(
  sourceText: string,
  path: string,
  options: { models: Models },
): string[] {
  return scan(sourceText, path, options.models).outside.map(
    (q) =>
      `${path}:${q.line}: queries ${q.models.join(", ")} outside a top-level function, where the scope check cannot see it. Move it into a function that takes maker: MakerRef first.`,
  );
}

function repositoryFunctions(
  sourceText: string,
  path: string,
  options: { models: Models },
): string[] {
  return scan(sourceText, path, options.models).functions.map((f) => f.name);
}

// A file outside the repositories that takes the database client itself.
function clientImports(sourceText: string, path: string): string[] {
  const file = parse(sourceText, path);
  const isDb = (specifier: string) =>
    specifier === "@/lib/db" ||
    (specifier.startsWith(".") &&
      posix(resolve(dirname(path), specifier)).endsWith("src/lib/db"));
  const found: string[] = [];
  const say = (node: ts.Node) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    found.push(
      `${path}:${line + 1}: imports the database client. Query in src/server (a function that takes maker: MakerRef first) and call that.`,
    );
  };
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isDb(node.moduleSpecifier.text)
    ) {
      const bindings = ts.isImportDeclaration(node)
        ? node.importClause?.namedBindings
        : node.exportClause;
      const named =
        bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))
          ? bindings.elements.map((e) => (e.propertyName ?? e.name).text)
          : null;
      // A namespace or a whole re-export carries the client with it.
      if (named === null || named.includes("db")) say(node);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      isDb(node.arguments[0].text)
    ) {
      say(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const SKIP = new Set(["__tests__", "__fixtures__", "__evals__"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return SKIP.has(name) ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const schema = readFileSync(join(root, SCHEMA), "utf8");
const MODELS = makerOwnedModels(schema);

const FIXTURE_SCHEMA = `
model Maker {
  id       String    @id
  projects Project[]
}

model Project {
  id      String @id
  makerId String
  maker   Maker  @relation(fields: [makerId], references: [id])
  cards   Card[]

  @@index([makerId])
}

model Product {
  id      String @id
  makerId String
  // @@index([makerId]) in a comment is not an index.
  sku     String

  @@unique([makerId, sku])
}

model GenerationJob {
  id        String   @id
  makerId   String
  projectId String?
  project   Project? @relation(fields: [projectId], references: [id])

  @@index([makerId, createdAt])
}

model Card {
  projectId String
  cardId    String
  project   Project @relation(fields: [projectId], references: [id])

  @@id([projectId, cardId])
}

model Note {
  id        String   @id
  projectId String?
  project   Project? @relation(fields: [projectId], references: [id])
}

model Organization {
  id    String @id
  maker Maker?
}
`;
const FIXTURE = makerOwnedModels(FIXTURE_SCHEMA);
const at = "src/server/fixture.ts";
const check = (source: string, makerIdFirst: string[] = []) =>
  unscoped(source, at, {
    models: FIXTURE,
    makerIdFirst: new Set(makerIdFirst.map((name) => `${at} ${name}`)),
  });

describe("which models belong to a maker", () => {
  it("reads them from the schema: a makerId column, a required parent that has one, and Maker", () => {
    expect(FIXTURE.withMakerId).toEqual([
      "Project",
      "Product",
      "GenerationJob",
    ]);
    // Note's parent is optional and Organization's side holds no key: neither
    // is a maker's.
    expect(FIXTURE.children).toEqual(["Card"]);
    expect(FIXTURE.all).toEqual([
      "Project",
      "Product",
      "GenerationJob",
      "Card",
      "Maker",
    ]);
    expect(FIXTURE.joins.Card).toEqual({ project: "Project" });
  });

  it("finds the studio's work in Kiln's schema and none of the account tables", () => {
    expect(MODELS.all).toEqual(
      expect.arrayContaining([
        "Maker",
        "Project",
        "Product",
        "Card",
        "GenerationJob",
        "ChatMessage",
      ]),
    );
    expect([...MODELS.children].sort()).toEqual([
      "Card",
      "ChatMessage",
      "MasterAsset",
      "ProjectProduct",
    ]);
    for (const account of [
      "User",
      "Session",
      "Account",
      "Verification",
      "Organization",
      "Member",
      "Invitation",
    ]) {
      expect(MODELS.all).not.toContain(account);
    }
  });
});

describe("a makerId column has an index that starts with it", () => {
  // A model whose index waits for a migration: "<Model>" -> why, and the
  // issue that adds it. It can only shrink.
  const UNINDEXED = new Map([
    ["GenerationBatch", "no index on makerId yet; additive migration in #50"],
  ]);

  it("reports a model with makerId and no index, and not one whose index starts with it", () => {
    const bare = `
model Thing {
  id        String   @id
  makerId   String
  createdAt DateTime

  @@index([createdAt, makerId])
}
`;
    expect(unindexed(bare)).toEqual(["Thing"]);
    expect(noIndex("Thing")).toBe(
      "prisma/schema.prisma Thing: has makerId but no index starting with it. Add @@index([makerId]) in a migration, or list it in UNINDEXED with the follow-up issue.",
    );
    expect(
      unindexed(bare.replace("[createdAt, makerId]", "[makerId, createdAt]")),
    ).toEqual([]);
    expect(
      unindexed(bare.replace("@@index([createdAt, makerId])", "")),
    ).toEqual(["Thing"]);
  });

  it("takes a unique key, a composite id or @unique on the column as the index", () => {
    expect(unindexed(FIXTURE_SCHEMA)).toEqual([]);
    const keyed = (line: string) => `
model Thing {
  makerId  String${line.startsWith("@@") ? "" : ` ${line}`}
  provider String
  ${line.startsWith("@@") ? line : ""}
}
`;
    expect(unindexed(keyed("@@id([makerId, provider])"))).toEqual([]);
    expect(unindexed(keyed("@@unique([makerId, provider])"))).toEqual([]);
    expect(unindexed(keyed("@unique"))).toEqual([]);
    expect(unindexed(keyed("@@id([provider, makerId])"))).toEqual(["Thing"]);
  });

  it("holds in Kiln's schema, but for the models listed with their follow-up", () => {
    expect(
      unindexed(schema)
        .filter((model) => !UNINDEXED.has(model))
        .map(noIndex),
    ).toEqual([]);
  });

  it("lists no model that is gone or has its index by now", () => {
    const missing = new Set(unindexed(schema));
    expect(
      [...UNINDEXED.keys()]
        .filter((model) => !missing.has(model))
        .map(
          (model) =>
            `UNINDEXED lists ${model}, which is gone or has its index now. Remove the entry.`,
        ),
    ).toEqual([]);
    for (const reason of UNINDEXED.values()) expect(reason).toMatch(/#\d+/);
  });
});

describe("the scope check on a fixture", () => {
  it("reports a function that queries with no maker at all", () => {
    expect(
      check(
        `export async function listThings() { return db.product.findMany(); }`,
      ),
    ).toEqual([
      "src/server/fixture.ts listThings: queries Product without a maker. Take maker: MakerRef first and filter by makerId: maker.id, or list it in UNSCOPED with the reason.",
    ]);
  });

  it("reports the same function written as a top-level const arrow", () => {
    const lines = check(
      `export const listThings = async () => db.product.findMany();`,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("listThings: queries Product without a maker");
  });

  it("reports a lookup by id alone in a function that takes the maker", () => {
    const lines = check(
      `export async function getThing(maker: MakerRef, id: string) { return db.product.findUnique({ where: { id } }); }`,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^src\/server\/fixture\.ts getThing: product\.findUnique at line 1 queries Product with a where that names no maker\./,
    );
  });

  it("accepts a lookup that names the maker, and a maker named by any other type is not the maker", () => {
    expect(
      check(
        `export async function getThing(maker: MakerRef, id: string) { return db.product.findFirst({ where: { id, makerId: maker.id } }); }`,
      ),
    ).toEqual([]);
    expect(
      check(
        `export async function getThing(maker: CurrentMaker, id: string) { return db.product.findFirst({ where: { id, makerId: maker.id } }); }`,
      ),
    ).toEqual([]);
    const lines = check(
      `export async function getThing(maker: string, id: string) { return db.product.findFirst({ where: { id, makerId: maker.id } }); }`,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("getThing: queries Product without a maker");
  });

  it("accepts a read by id after the row was locked under its maker", () => {
    expect(
      check(`
export async function setSlotApproval(maker: MakerRef, projectId: string) {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>\`
      SELECT "id" FROM "Project"
      WHERE "id" = \${projectId} AND "makerId" = \${maker.id} FOR UPDATE\`;
    if (locked.length === 0) return null;
    const row = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    await tx.project.update({ where: { id: projectId }, data: { plan: row.plan } });
    return row;
  });
}`),
    ).toEqual([]);
  });

  it("does not take a lock on another column, or on another maker's value, for the maker's", () => {
    const body = (lock: string) => `
export async function setSlot(maker: MakerRef, projectId: string, other: string) {
  await db.$queryRaw\`SELECT "id" FROM "Project" WHERE ${lock} FOR UPDATE\`;
  return db.project.findUniqueOrThrow({ where: { id: projectId } });
}`;
    expect(check(body(`"id" = \${projectId}`))).toHaveLength(1);
    expect(check(body(`"makerId" = \${other}`))).toHaveLength(1);
    expect(check(body(`"makerId" = \${maker.id}`))).toEqual([]);
  });

  it("reports a list by a project id alone", () => {
    const lines = check(
      `export async function listJobs(maker: MakerRef, projectId: string) { return db.generationJob.findMany({ where: { projectId } }); }`,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(
      "listJobs: generationJob.findMany at line 1 queries GenerationJob with a where that names no maker.",
    );
  });

  it("accepts that list after the project was read under its maker in the same body", () => {
    expect(
      check(`
export async function listJobs(maker: MakerRef, projectId: string) {
  await db.project.findFirst({ where: { id: projectId, makerId: maker.id } });
  return db.generationJob.findMany({ where: { projectId } });
}`),
    ).toEqual([]);
  });

  it("still reports the list when the scoped read comes after it", () => {
    const lines = check(`
export async function listJobs(maker: MakerRef, projectId: string) {
  const jobs = await db.generationJob.findMany({ where: { projectId } });
  await db.project.findFirst({ where: { id: projectId, makerId: maker.id } });
  return jobs;
}`);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("listJobs: generationJob.findMany at line 3");
  });

  it("a scoped read in another function excuses nothing", () => {
    const lines = check(`
async function owned(maker: MakerRef, projectId: string) {
  return db.project.findFirst({ where: { id: projectId, makerId: maker.id } });
}
export async function listJobs(maker: MakerRef, projectId: string) {
  await owned(maker, projectId);
  return db.generationJob.findMany({ where: { projectId } });
}`);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("listJobs: generationJob.findMany at line 7");
  });

  it("accepts the makerId shorthand in a function listed as scoped by a makerId string, and only there", () => {
    const source = `export async function countJobs(makerId: string, projectId: string) { return db.generationJob.count({ where: { projectId, makerId } }); }`;
    expect(check(source, ["countJobs"])).toEqual([]);
    expect(check(source)).toEqual([
      "src/server/fixture.ts countJobs: queries GenerationJob without a maker. Take maker: MakerRef first and filter by makerId: maker.id, or list it in UNSCOPED with the reason.",
    ]);
    // The maker's id under another name is not the maker.
    const renamed = check(
      `export async function countJobs(maker: MakerRef, makerId: string) { return db.generationJob.count({ where: { makerId } }); }`,
    );
    expect(renamed).toHaveLength(1);
    expect(renamed[0]).toContain("countJobs: generationJob.count at line 1");
  });

  it("accepts input.makerId, a compound key that starts with makerId and a lock on the makerId string there too", () => {
    expect(
      check(
        `
export async function reserve(input: { makerId: string; sku: string }) {
  return db.generationJob.findMany({ where: { makerId: input.makerId } });
}
export async function bySku(makerId: string, sku: string) {
  return db.product.findUnique({ where: { makerId_sku: { makerId, sku } } });
}
export async function enqueue(makerId: string, projectId: string) {
  await db.$queryRaw\`SELECT "id" FROM "Project" WHERE "id" = \${projectId} AND "makerId" = \${makerId} FOR UPDATE\`;
  return db.generationJob.findMany({ where: { projectId } });
}`,
        ["reserve", "bySku", "enqueue"],
      ),
    ).toEqual([]);
    expect(
      check(
        `export async function bySku(maker: MakerRef, sku: string) { return db.product.findUnique({ where: { makerId_sku: { makerId: maker.id, sku } } }); }`,
      ),
    ).toEqual([]);
  });

  it("a function listed as scoped by a makerId string is still read query by query", () => {
    const lines = check(
      `export async function countJobs(makerId: string, projectId: string) { return db.generationJob.count({ where: { projectId } }); }`,
      ["countJobs"],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("countJobs: generationJob.count at line 1");
  });

  it("accepts a where that reaches the maker through the parent", () => {
    expect(
      check(
        `export async function listJobs(maker: MakerRef, projectId: string) { return db.generationJob.findMany({ where: { projectId, project: { makerId: maker.id } } }); }`,
      ),
    ).toEqual([]);
  });

  it("reports a count with no where and nothing read under the maker before it", () => {
    const lines = check(
      `export async function jobsByStatus(maker: MakerRef) { return db.generationJob.groupBy({ by: ["status"] }); }`,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(
      "jobsByStatus: generationJob.groupBy at line 1 queries GenerationJob",
    );
  });

  it("reports every list, count and bulk call the same way, and never a create", () => {
    for (const method of [...BY_KEY, ...LISTS]) {
      const lines = check(
        `export async function work(maker: MakerRef, id: string) { return db.project.${method}({ where: { id } }); }`,
      );
      expect(lines, method).toHaveLength(1);
      expect(lines[0], method).toContain(`work: project.${method} at line 1`);
    }
    expect(
      check(
        `export async function add(maker: MakerRef, name: string) { return db.project.create({ data: { makerId: maker.id, name } }); }`,
      ),
    ).toEqual([]);
  });

  it("reports a child's lookup by its parent's id alone", () => {
    const lines = check(
      `export async function getCard(maker: MakerRef, projectId: string, cardId: string) { return db.card.findUnique({ where: { projectId_cardId: { projectId, cardId } } }); }`,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /getCard: card\.findUnique at line 1 queries Card with a where that names no maker\. Join its where through the parent/,
    );
  });

  it("accepts a child's query joined to its parent's maker, and no makerId of its own", () => {
    expect(
      check(
        `export async function getCard(maker: MakerRef, projectId: string, cardId: string) { return db.card.findMany({ where: { projectId, project: { makerId: maker.id } } }); }`,
      ),
    ).toEqual([]);
    expect(
      check(
        `export async function getCard(makerId: string, projectId: string) { return db.card.findMany({ where: { projectId, project: { makerId } } }); }`,
        ["getCard"],
      ),
    ).toEqual([]);
    // A Card has no makerId column: naming one is not a join.
    expect(
      check(
        `export async function getCard(maker: MakerRef, projectId: string) { return db.card.findMany({ where: { projectId, makerId: maker.id } }); }`,
      ),
    ).toHaveLength(1);
  });

  it("reads a where kept in a const of the same body", () => {
    expect(
      check(`
export async function noteApproval(maker: MakerRef, projectId: string) {
  const where = { makerId: maker.id, projectId };
  return db.generationJob.findFirst({ where });
}
export async function latest(maker: MakerRef, projectId: string) {
  const mine = { makerId: maker.id, projectId } satisfies Filter;
  return db.generationJob.findFirst({ where: mine });
}`),
    ).toEqual([]);
    const lines = check(`
export async function noteApproval(maker: MakerRef, projectId: string) {
  const where = { projectId };
  return db.generationJob.findFirst({ where });
}`);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(
      "noteApproval: generationJob.findFirst at line 4",
    );
  });

  it("does not trust a where built by a helper or a spread, unless a scoped read came first", () => {
    const helper = check(`
export async function listJobs(maker: MakerRef, projectId: string) {
  return db.generationJob.findMany({ where: mine(maker, projectId) });
}`);
    expect(helper).toHaveLength(1);
    expect(helper[0]).toContain("listJobs: generationJob.findMany at line 3");
    const spread = check(`
export async function listJobs(maker: MakerRef, filter: object) {
  return db.generationJob.findMany({ where: { ...filter } });
}`);
    expect(spread).toHaveLength(1);
    expect(spread[0]).toContain("listJobs: generationJob.findMany at line 3");
    expect(
      check(`
export async function listJobs(maker: MakerRef, projectId: string) {
  await db.project.findFirstOrThrow({ where: { id: projectId, makerId: maker.id } });
  return db.generationJob.findMany({ where: mine(maker, projectId) });
}`),
    ).toEqual([]);
  });

  it("reports a function that takes the maker and never uses it", () => {
    expect(
      check(`
export async function monthSpend(maker: MakerRef, projectId: string) {
  return db.$queryRaw\`SELECT SUM("actualMicros") FROM "GenerationJob" WHERE "projectId" = \${projectId}\`;
}`),
    ).toEqual([
      "src/server/fixture.ts monthSpend: queries GenerationJob without a maker. Take maker: MakerRef first and filter by makerId: maker.id, or list it in UNSCOPED with the reason.",
    ]);
  });

  it("reads the maker's own row by maker.id", () => {
    expect(
      check(`
export async function getBrand(maker: MakerRef) {
  return db.maker.findUnique({ where: { id: maker.id } });
}
async function updatePreferences(maker: MakerRef, changed: object) {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw\`SELECT "id" FROM "Maker" WHERE "id" = \${maker.id} FOR UPDATE\`;
    await tx.maker.update({ where: { id: maker.id }, data: changed });
  });
}`),
    ).toEqual([]);
    const lines = check(
      `export async function getBrand(maker: MakerRef, slug: string) { return db.maker.findUnique({ where: { slug } }); }`,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("getBrand: maker.findUnique at line 1");
  });

  it("leaves a function listed as working without a maker alone, and one that queries no maker's data", () => {
    expect(
      unscoped(
        `export async function claimJobs() { return db.generationJob.findMany(); }`,
        at,
        { models: FIXTURE, unscoped: new Set([`${at} claimJobs`]) },
      ),
    ).toEqual([]);
    expect(
      check(
        `export async function listTeam(organizationId: string) { return db.member.findMany({ where: { organizationId } }); }`,
      ),
    ).toEqual([]);
  });
});

describe("queries the scope check cannot see, on a fixture", () => {
  const outside = (source: string) =>
    outsideShapes(source, at, { models: FIXTURE });

  it("reports a query inside a tool's definition", () => {
    expect(
      outside(
        `export const listTool = defineTool({ execute: async () => db.product.findMany() });`,
      ),
    ).toEqual([
      "src/server/fixture.ts:1: queries Product outside a top-level function, where the scope check cannot see it. Move it into a function that takes maker: MakerRef first.",
    ]);
  });

  it("reports a query inside a wrapped const", () => {
    expect(
      outside(`import { cache } from "react";

const latest = cache(async () => db.project.findFirst());`),
    ).toEqual([
      "src/server/fixture.ts:3: queries Project outside a top-level function, where the scope check cannot see it. Move it into a function that takes maker: MakerRef first.",
    ]);
  });

  it("reports a query in a method, at the top of the module, and raw SQL on a maker's table", () => {
    const lines = outside(`
class Jobs {
  list() { return db.generationJob.findMany(); }
}
export const cards = { all: () => db.card.findMany() };
export const first = await db.project.create({ data: {} });
export const spent = cache(() => db.$queryRaw\`SELECT 1 FROM "GenerationJob"\`);
export const members = cache(() => db.member.findMany());
`);
    expect(lines.map((line) => line.split(" outside ")[0])).toEqual([
      "src/server/fixture.ts:3: queries GenerationJob",
      "src/server/fixture.ts:5: queries Card",
      "src/server/fixture.ts:6: queries Project",
      "src/server/fixture.ts:7: queries GenerationJob",
    ]);
  });

  it("does not report the same queries inside a top-level function, nor in a callback nested in one", () => {
    const source = `
export async function listThings(maker: MakerRef) { return db.product.findMany({ where: { makerId: maker.id } }); }
export const latest = async (maker: MakerRef) => db.project.findFirst({ where: { makerId: maker.id } });
export async function rename(maker: MakerRef, id: string, name: string) {
  return db.$transaction(async (tx) => {
    await tx.project.updateMany({ where: { id, makerId: maker.id }, data: { name } });
    const settle = () => tx.project.findUniqueOrThrow({ where: { id } });
    return settle();
  });
}`;
    expect(outside(source)).toEqual([]);
    expect(repositoryFunctions(source, at, { models: FIXTURE })).toEqual([
      "listThings",
      "latest",
      "rename",
    ]);
  });
});

describe("the database client stays in the repositories", () => {
  const page = "src/app/projects/page.tsx";

  it("reports a file that imports the client, however it is written", () => {
    for (const source of [
      `import { db } from "@/lib/db";`,
      `import { hasDatabase, db as client } from "@/lib/db";`,
      `import * as database from "@/lib/db";`,
      `export { db } from "@/lib/db";`,
      `const { db } = await import("@/lib/db");`,
    ]) {
      expect(clientImports(source, page), source).toEqual([
        "src/app/projects/page.tsx:1: imports the database client. Query in src/server (a function that takes maker: MakerRef first) and call that.",
      ]);
    }
    expect(
      clientImports(`import { db } from "./db";`, "src/lib/plural.ts"),
    ).toHaveLength(1);
  });

  it("lets a file ask whether there is a database", () => {
    expect(
      clientImports(
        `import { assertDatabaseUrl, hasDatabase } from "@/lib/db";\nimport { db } from "./db";`,
        page,
      ),
    ).toEqual([]);
  });

  it("no page, action, route, component or library file imports it", () => {
    const src = join(root, "src");
    const files = ["app", "components", "lib"]
      .flatMap((dir) => sources(join(src, dir)))
      .filter((path) => path !== join(src, "lib", "db.ts"));
    expect(files.length).toBeGreaterThan(200);
    expect(
      files.flatMap((path) =>
        clientImports(readFileSync(path, "utf8"), posix(relative(root, path))),
      ),
    ).toEqual([]);
  });
});

// Everything below reads src/server and src/modules as they are.
describe("every repository function names the maker", () => {
  // Functions that query a maker's data without being handed the maker, by
  // design: "<path> <function>" -> why. It can only shrink.
  const UNSCOPED = new Map([
    // The worker and its leases: keyed by a claimed job's id and lease token,
    // or running for every maker.
    [
      "src/server/generation-repository.ts claimJobs",
      "the worker claims queued jobs of every maker",
    ],
    [
      "src/server/generation-repository.ts renewLease",
      "keyed by a claimed job's id and lease token",
    ],
    [
      "src/server/generation-repository.ts markCallStarted",
      "keyed by a claimed job's id and lease token",
    ],
    [
      "src/server/generation-repository.ts recordCost",
      "keyed by a claimed job's id and lease token",
    ],
    [
      "src/server/generation-repository.ts completeJob",
      "keyed by a claimed job's id and lease token",
    ],
    [
      "src/server/generation-repository.ts failJob",
      "keyed by a claimed job's id and lease token",
    ],
    [
      "src/server/generation-repository.ts fallBackJob",
      "keyed by a claimed job's id and lease token",
    ],
    [
      "src/server/generation-repository.ts requeueExpired",
      "the worker requeues expired leases of every maker",
    ],
    [
      "src/server/generation-repository.ts markDirectCall",
      "keyed by the direct call the caller just reserved",
    ],
    [
      "src/server/generation-repository.ts closeDirectCall",
      "keyed by the direct call the caller just reserved",
    ],
    [
      "src/server/generation-repository.ts spend",
      "the month's spend read inside a transaction that already holds the maker's lock",
    ],
    [
      "src/server/batch-end.ts finishBatch",
      "the worker closes the batch of the job it just ended",
    ],
    [
      "src/server/qc/project-take.ts takeContext",
      "the worker's claimed job, or a project recheckTake read under its maker",
    ],
    [
      "src/server/chat/chat-repository.ts appendChatEvent",
      "the worker tells a project's chat what its job did",
    ],
    // The edge and the account: how the maker comes to be known.
    [
      "src/server/access-tokens.ts verifyAccessToken",
      "the edge working out which maker a token names",
    ],
    [
      "src/server/maker-repository.ts makerOfToken",
      "the edge working out which maker a token names",
    ],
    [
      "src/server/maker-repository.ts getCurrentMaker",
      "the instance's own maker, for a script or a test with no request",
    ],
    [
      "src/server/organization.ts claimInstance",
      "the first account claims the instance's maker",
    ],
  ]);

  // Functions scoped by a makerId string (a parameter, input.makerId or a
  // context that holds the maker), the shape from before MakerRef:
  // "<path> <function>" -> where the id comes from. It can only shrink.
  const MAKER_ID_FIRST = new Map([
    ["src/server/generation-repository.ts budget", "makerId parameter"],
    ["src/server/generation-repository.ts cancelBatch", "makerId parameter"],
    ["src/server/generation-repository.ts readUnlisted", "makerId parameter"],
    [
      "src/server/generation-repository.ts projectGenerationState",
      "makerId parameter",
    ],
    ["src/server/generation-repository.ts sessionSpend", "makerId parameter"],
    ["src/server/generation-repository.ts enqueueBatch", "input.makerId"],
    ["src/server/generation-repository.ts reserveDirectCall", "input.makerId"],
    ["src/server/generation-repository.ts recordKeyCheck", "input.makerId"],
    ["src/server/home-repository.ts homeStats", "makerId parameter"],
    ["src/server/provider-health.ts providerHealth", "makerId parameter"],
    ["src/server/provider-keys.ts read", "makerId parameter"],
    ["src/server/provider-keys.ts providerKeyStates", "makerId parameter"],
    ["src/server/provider-keys.ts saveProviderKey", "makerId parameter"],
    ["src/server/provider-keys.ts removeProviderKey", "makerId parameter"],
    ["src/server/shop-connection.ts markNeedsReconnect", "makerId parameter"],
    ["src/server/shop-ranking.ts projectsByListing", "makerId parameter"],
    ["src/server/lessons.ts proposeFromTaste", "makerId parameter"],
    [
      "src/server/etsy-drafts.ts defaultSettings",
      "makerId parameter, beside the connected shop",
    ],
    ["src/server/tool-calls.ts callAndRecord", "the tool context's maker"],
  ]);

  const files = [
    ...sources(join(root, "src", "server")),
    ...sources(join(root, "src", "modules")),
  ].map((path) => ({
    path: posix(relative(root, path)),
    text: readFileSync(path, "utf8"),
  }));
  const reports = (lists: { unscoped: Listed; makerIdFirst: Listed }) =>
    files.flatMap((f) =>
      unscoped(f.text, f.path, { models: MODELS, ...lists }),
    );
  const found = new Set(
    files.flatMap((f) =>
      repositoryFunctions(f.text, f.path, { models: MODELS }).map(
        (name) => `${f.path} ${name}`,
      ),
    ),
  );
  // An entry is stale when its function is gone, or passes without it.
  const stale = (name: string, map: Map<string, string>) =>
    [...map.keys()].flatMap((key) => {
      if (!found.has(key)) {
        return [
          `${name} lists "${key}", which is not a function that queries a maker's data. Remove the entry.`,
        ];
      }
      const without = { has: (k: string) => k !== key && map.has(k) };
      const lines = reports({
        unscoped: map === UNSCOPED ? without : UNSCOPED,
        makerIdFirst: map === MAKER_ID_FIRST ? without : MAKER_ID_FIRST,
      });
      return lines.some((line) => line.startsWith(`${key}:`))
        ? []
        : [
            `${name} lists "${key}", which passes without it. Remove the entry.`,
          ];
    });

  it("finds the repository functions", () => {
    expect(found.size).toBeGreaterThanOrEqual(100);
  });

  it("each takes the maker first and names it in every query, or follows a read under the maker", () => {
    expect(
      reports({ unscoped: UNSCOPED, makerIdFirst: MAKER_ID_FIRST }),
    ).toEqual([]);
  });

  it("no query of a maker's data sits where the check cannot see it", () => {
    expect(
      files.flatMap((f) => outsideShapes(f.text, f.path, { models: MODELS })),
    ).toEqual([]);
  });

  it("the functions listed as working without a maker still exist and still need it", () => {
    expect(stale("UNSCOPED", UNSCOPED)).toEqual([]);
    for (const reason of UNSCOPED.values()) expect(reason).not.toBe("");
  });

  it("the functions listed as scoped by a makerId string still exist and still need it", () => {
    expect(stale("MAKER_ID_FIRST", MAKER_ID_FIRST)).toEqual([]);
    for (const reason of MAKER_ID_FIRST.values()) expect(reason).not.toBe("");
  });
});
