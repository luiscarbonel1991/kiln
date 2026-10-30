import {
  approveFrame,
  getFrames,
  listProjects,
  rejectFrame,
  switchFrame,
  tuneFrame,
  unapproveFrame,
  viewFrame,
} from "@/server/tools/board";
import {
  bestSellersTool,
  editListingTool,
  findShopsTool,
  getListingTool,
  listResultsTool,
  saveBriefTool,
  saveReadTool,
  shopFavouritesTool,
  watchedShopsTool,
} from "@/server/tools/listings";
import {
  generate,
  quote,
  reviewProductTool,
  writeListingTool,
} from "@/server/tools/paid";
import { importProductsTool, listProductsTool } from "@/server/tools/products";
import {
  createProjectTool,
  deliverTool,
  planProjectTool,
} from "@/server/tools/projects";
import type { Tool } from "@/server/tools/registry";

// Every tool Kiln serves, in the order a client lists them.
export const TOOLS: readonly Tool[] = [
  listProductsTool,
  importProductsTool,
  planProjectTool,
  createProjectTool,
  listProjects,
  getFrames,
  viewFrame,
  approveFrame,
  unapproveFrame,
  rejectFrame,
  tuneFrame,
  switchFrame,
  quote,
  generate,
  writeListingTool,
  getListingTool,
  editListingTool,
  reviewProductTool,
  deliverTool,
  saveBriefTool,
  listResultsTool,
  saveReadTool,
  bestSellersTool,
  watchedShopsTool,
  findShopsTool,
  shopFavouritesTool,
];
