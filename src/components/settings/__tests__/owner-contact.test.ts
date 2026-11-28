import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OwnerContact } from "@/components/settings/owner-contact";

const contact = (owner: { name: string; email: string }) =>
  renderToStaticMarkup(createElement(OwnerContact, { owner }));

describe("the owner a member writes to", () => {
  it("shows the owner's name and the email to write to", () => {
    const html = contact({ name: "Ana Ruiz", email: "ana@example.test" });
    expect(html).toContain("Ana Ruiz");
    expect(html).toContain('href="mailto:ana@example.test"');
    expect(html).toContain('aria-label="Write to Ana Ruiz"');
  });

  // An owner with no name is still someone to write to: by their email,
  // shown once.
  it("shows an owner with no name by their email", () => {
    const html = contact({ name: "", email: "ana@example.test" });
    expect(html).toContain('href="mailto:ana@example.test"');
    expect(html).toContain('aria-label="Write to ana@example.test"');
    expect(html.match(/ana@example\.test<\/a>/g)).toHaveLength(1);
    expect(html).toContain(">A</span>");
  });
});
