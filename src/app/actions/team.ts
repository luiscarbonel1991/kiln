"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { InviteForm } from "@/lib/account-forms";
import { ownerAction } from "@/server/guarded";
import {
  cancelInvitation,
  type InvitationView,
  inviteMember,
  removeMember,
} from "@/server/team";

// Settings → Team, the owner's alone. Zod is the trust boundary.

const failed = (error: unknown) => ({
  error: error instanceof Error ? error.message : String(error),
});

export const inviteMemberAction = ownerAction(
  async (
    maker,
    input: unknown,
  ): Promise<{ invitation: InvitationView } | { error: string }> => {
    const parsed = InviteForm.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Write an email." };
    }
    try {
      const invitation = await inviteMember(maker, parsed.data.email);
      refresh();
      return { invitation };
    } catch (error) {
      return failed(error);
    }
  },
);

export const cancelInvitationAction = ownerAction(
  async (maker, input: unknown): Promise<{ error?: string }> => {
    const parsed = z.string().min(1).safeParse(input);
    if (!parsed.success) return { error: "Which invitation?" };
    try {
      await cancelInvitation(maker, parsed.data);
      refresh();
      return {};
    } catch (error) {
      return failed(error);
    }
  },
);

export const removeMemberAction = ownerAction(
  async (maker, input: unknown): Promise<{ error?: string }> => {
    const parsed = z.string().min(1).safeParse(input);
    if (!parsed.success) return { error: "Who?" };
    try {
      await removeMember(maker, parsed.data);
      refresh();
      return {};
    } catch (error) {
      return failed(error);
    }
  },
);
