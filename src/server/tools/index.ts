import {
  approveFrame,
  getFrames,
  listProjects,
  rejectFrame,
  unapproveFrame,
  viewFrame,
} from "@/server/tools/board";
import {
  generate,
  quote,
  reviewProductTool,
  writeListingTool,
} from "@/server/tools/paid";
import { listProductsTool } from "@/server/tools/products";
import type { Tool } from "@/server/tools/registry";

// Every tool Kiln serves, in the order a client lists them.
export const TOOLS: readonly Tool[] = [
  listProductsTool,
  listProjects,
  getFrames,
  viewFrame,
  approveFrame,
  unapproveFrame,
  rejectFrame,
  quote,
  generate,
  writeListingTool,
  reviewProductTool,
];
