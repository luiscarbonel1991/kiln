// How the drafts pages say a price, a write and a time.

export function priceLabel(value: number, currency: string | undefined) {
  if (!currency) return value.toFixed(2);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export const WRITE_LABEL: Record<string, string> = {
  create: "Made the draft",
  photos: "Sent its photos",
  edit: "Changed its text",
  price: "Changed its price or quantity",
  "photo-add": "Added a photo",
  "photo-remove": "Removed a photo",
};

export const WRITE_STATUS: Record<string, string> = {
  pending: "sending",
  done: "done",
  failed: "refused",
  unanswered: "no answer",
};

export const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  description: "Description",
  tags: "Tags",
  materials: "Materials",
  taxonomyId: "Category",
  whoMade: "Who made it",
  whenMade: "When it was made",
  shippingProfileId: "Shipping profile",
  readinessStateId: "Processing profile",
  price: "Price",
  quantity: "Quantity",
  photos: "Photos",
};

export const whenLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// A list typed as words between commas, back as the list.
export const wordsOf = (text: string) =>
  text
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);
