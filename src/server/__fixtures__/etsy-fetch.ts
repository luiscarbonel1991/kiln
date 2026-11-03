import type { DraftFields } from "@/domain/etsy-draft";
import type { EtsyReader } from "@/providers/shop/etsy";
import type {
  DraftEdit,
  EtsyDraftWriter,
  InventoryBody,
} from "@/providers/shop/etsy-drafts";
import { MOCK_TAXONOMY } from "@/providers/shop/etsy-drafts-mock";

// Etsy's form fields, back as the writer's (a list is one comma-joined value).
function formFields(
  form: URLSearchParams,
): DraftEdit & Partial<Pick<DraftFields, "price" | "quantity">> {
  const num = (key: string) =>
    form.has(key) ? Number(form.get(key)) : undefined;
  const list = (key: string) =>
    form.has(key)
      ? (form.get(key) ?? "").split(",").filter(Boolean)
      : undefined;
  const fields = {
    title: form.get("title") ?? undefined,
    description: form.get("description") ?? undefined,
    price: num("price"),
    quantity: num("quantity"),
    whoMade: (form.get("who_made") ?? undefined) as DraftFields["whoMade"],
    whenMade: (form.get("when_made") ?? undefined) as DraftFields["whenMade"],
    taxonomyId: num("taxonomy_id"),
    tags: list("tags"),
    materials: list("materials"),
    shippingProfileId: num("shipping_profile_id"),
    readinessStateId: num("readiness_state_id"),
  };
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  );
}

// A request's body as sent: a form or JSON as an object, a multipart form's
// fields by name (a file by its name).
export async function sentBody(
  init: RequestInit | undefined,
): Promise<Record<string, unknown>> {
  const body = init?.body;
  if (body === undefined || body === null) return {};
  if (body instanceof FormData) {
    return Object.fromEntries(
      [...body.entries()].map(([k, v]) => [
        k,
        typeof v === "string" ? v : v.name,
      ]),
    );
  }
  const text = String(body);
  return text.startsWith("{")
    ? (JSON.parse(text) as Record<string, unknown>)
    : Object.fromEntries(new URLSearchParams(text));
}

// A fetch that answers Etsy's API from an EtsyReader (the mock shop), in
// Etsy's shapes, and its OAuth token endpoint from a queue of answers: the
// live code paths run end to end with no network. With a draft writer it
// also answers the draft reads and writes; `fail` answers a request instead
// (a refusal, a server error). Every request is kept.
export function etsyFetch(
  reader: EtsyReader,
  tokens: { status?: number; body: unknown }[] = [],
  options: {
    drafts?: EtsyDraftWriter;
    fail?: (method: string, path: string) => Response | undefined;
  } = {},
) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const answer = (status: number, body: unknown) =>
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status });
  const fetch = async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname === "/v3/public/oauth/token") {
      const next = tokens.shift();
      return next
        ? answer(next.status ?? 200, next.body)
        : answer(500, { error: "no token answer queued" });
    }
    const path = url.pathname.replace("/v3/application", "");
    const q = url.searchParams;
    const page = {
      limit: Number(q.get("limit") ?? 25),
      offset: Number(q.get("offset") ?? 0),
    };
    const method = init?.method ?? "GET";
    const failed = options.fail?.(method, path);
    if (failed) return failed;
    try {
      const drafts = options.drafts;
      if (drafts) {
        const answered = await draftRoute(drafts, method, path, q, init);
        if (answered) return answer(answered.status, answered.body);
      }
      if (path === "/users/me") return answer(200, await reader.me());
      if (path === "/shops") {
        const results = await reader.findShops(q.get("shop_name") ?? "");
        return answer(200, { count: results.length, results });
      }
      const receipts = path.match(/^\/shops\/(\d+)\/receipts$/);
      if (receipts) {
        return answer(
          200,
          await reader.receipts(Number(receipts[1]), {
            minCreated: Number(q.get("min_created") ?? 0),
            maxCreated: q.get("max_created")
              ? Number(q.get("max_created"))
              : undefined,
            ...page,
          }),
        );
      }
      if (path === "/listings/batch") {
        const ids = (q.get("listing_ids") ?? "")
          .split(",")
          .filter(Boolean)
          .map(Number);
        const results = await reader.listings(ids);
        return answer(200, { count: results.length, results });
      }
      const listings = path.match(/^\/shops\/(\d+)\/listings\/active$/);
      if (listings) {
        return answer(
          200,
          await reader.activeListings(Number(listings[1]), page),
        );
      }
      const shop = path.match(/^\/shops\/(\d+)$/);
      if (shop) return answer(200, await reader.shop(Number(shop[1])));
      return answer(404, { error: `No route ${path}` });
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      return answer(status, { error: (error as Error).message });
    }
  };
  return { fetch, calls };
}

// The draft endpoints, from a draft writer (the mock shop's).
async function draftRoute(
  drafts: EtsyDraftWriter,
  method: string,
  path: string,
  q: URLSearchParams,
  init: RequestInit | undefined,
): Promise<{ status: number; body: unknown } | null> {
  const page = {
    limit: Number(q.get("limit") ?? 25),
    offset: Number(q.get("offset") ?? 0),
  };
  const form = () => new URLSearchParams(String(init?.body ?? ""));
  let m = path.match(/^\/shops\/(\d+)\/listings$/);
  if (m && method === "GET" && q.get("state") === "draft") {
    return { status: 200, body: await drafts.drafts(Number(m[1]), page) };
  }
  if (m && method === "POST") {
    const fields = formFields(form()) as DraftFields;
    return {
      status: 201,
      body: await drafts.createDraft(Number(m[1]), fields),
    };
  }
  m = path.match(/^\/shops\/(\d+)\/listings\/(\d+)$/);
  if (m && method === "PATCH") {
    return {
      status: 200,
      body: await drafts.updateDraft(
        Number(m[1]),
        Number(m[2]),
        formFields(form()),
      ),
    };
  }
  m = path.match(/^\/listings\/(\d+)$/);
  if (m && method === "GET") {
    return { status: 200, body: await drafts.listing(Number(m[1])) };
  }
  m = path.match(/^\/listings\/(\d+)\/inventory$/);
  if (m && method === "GET") {
    return { status: 200, body: await drafts.inventory(Number(m[1])) };
  }
  if (m && method === "PUT") {
    await drafts.setInventory(
      Number(m[1]),
      JSON.parse(String(init?.body)) as InventoryBody,
    );
    return { status: 200, body: await drafts.inventory(Number(m[1])) };
  }
  m = path.match(/^\/shops\/(\d+)\/listings\/(\d+)\/images$/);
  if (m && method === "POST") {
    const body = init?.body as FormData;
    const file = body.get("image") as File;
    return {
      status: 201,
      body: await drafts.addPhoto(Number(m[1]), Number(m[2]), {
        bytes: new Uint8Array(await file.arrayBuffer()),
        mime: file.type,
        filename: file.name,
        rank: Number(body.get("rank") ?? 1),
      }),
    };
  }
  m = path.match(/^\/shops\/(\d+)\/listings\/(\d+)\/images\/(\d+)$/);
  if (m && method === "DELETE") {
    await drafts.removePhoto(Number(m[1]), Number(m[2]), Number(m[3]));
    return { status: 204, body: null };
  }
  if (path === "/seller-taxonomy/nodes") {
    return {
      status: 200,
      body: { count: MOCK_TAXONOMY.length, results: MOCK_TAXONOMY },
    };
  }
  if (/^\/shops\/\d+\/shipping-profiles$/.test(path)) {
    return {
      status: 200,
      body: {
        count: 1,
        results: [{ shipping_profile_id: 7001, title: "Standard shipping" }],
      },
    };
  }
  if (/^\/shops\/\d+\/readiness-state-definitions$/.test(path)) {
    return {
      status: 200,
      body: {
        count: 1,
        results: [
          {
            readiness_state_id: 8001,
            readiness_state: "made_to_order",
            processing_days_display_label: "3-5 days",
          },
        ],
      },
    };
  }
  return null;
}
