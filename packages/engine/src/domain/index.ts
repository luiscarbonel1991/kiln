export { BrandProfile } from "@/domain/brand";
export {
  Capabilities,
  canUse,
  type ImageOp,
  PROVIDER_CAPABILITIES,
} from "@/domain/capabilities";
export { Card } from "@/domain/card";
export { buildCards } from "@/domain/cards";
export {
  assemblePrompt,
  buildPlanningContext,
  type CardFieldsLike,
  FIELD_KEYS,
  type FieldKey,
  PlanningFields,
  resolveField,
} from "@/domain/cascade";
export {
  Aspect,
  Delivery,
  DestinationFormat,
  DestinationKind,
  DestinationProfile,
  DestinationRules,
} from "@/domain/destination";
export {
  type ExactView,
  exactView,
  renderTextTemplate,
} from "@/domain/exact";
export { Field, FieldSource } from "@/domain/field";
export {
  canAfford,
  costFromUsage,
  estimateGeneration,
  estimateScenes,
  fromMicros,
  type GenerationUsage,
  IMAGE_PRICES,
  type ImagePrice,
  imagePrice,
  PRICES_AS_OF,
  type SceneEstimate,
  toMicros,
} from "@/domain/generation-cost";
export {
  buildGenerationRequest,
  GenerationRequest,
} from "@/domain/generation-request";
export { lockByDefault } from "@/domain/locks";
export { MasterAsset } from "@/domain/master-asset";
export { ModelConfig } from "@/domain/model-config";
export {
  DEFAULT_MODEL_IDS,
  DEFAULT_PROVIDER,
  defaultImageModel,
  defaultVideoModel,
  GENERATION_PROVIDERS,
  generationCatalog,
  generationModel,
} from "@/domain/model-defaults";
export {
  PersistedProject,
  PersistedProjectRecord,
} from "@/domain/persisted-project";
export {
  approveSlot,
  type Catalog,
  destinationsFor,
  offeredDestinations,
  PlanDestination,
  PlanSlot,
  ProjectPlan,
  parseSlotRecipeId,
  planCounts,
  planProject,
  type SlotRef,
  SlotState,
  type SlotView,
  shotListFor,
  slotCardId,
  slotRecipeId,
  slotState,
  unapproveSlot,
} from "@/domain/plan";
export {
  ColourOption,
  colourOf,
  Dimensions,
  dimensionsLabel,
  PlatePiece,
  PlateRequest,
  PlateResult,
  Product,
  ProductIcon,
  ProductSource,
  productPromptFields,
  Treatment,
  Typography,
  VariantAxis,
  validateWording,
  WordingLine,
} from "@/domain/product";
export { productUnderstanding } from "@/domain/product-understanding";
export { ProjectType } from "@/domain/project";
export {
  checkExpectedText,
  type ExpectedText,
  lenientKey,
  normalizeText,
  type OcrBox,
  type OcrLine,
  type OcrResult,
  type TextCheck,
  type TextCheckOptions,
  type TextLineFinding,
} from "@/domain/qc";
export {
  ACTIVE_JOB_STATUSES,
  classifyGenerationError,
  errorMessage,
  isActiveJob,
  JobStatus,
  type JobView,
  MAX_ATTEMPTS,
  RETRY_BACKOFF_MS,
  retryDecision,
} from "@/domain/queue";
export {
  composePreset,
  composeRecipe,
  ListingSlot,
  Recipe,
  RecipePreset,
} from "@/domain/recipe";
export {
  SEED_BRAND,
  SEED_DESTINATIONS,
  SEED_RECIPE,
  SEED_RECIPE_ADS,
  SEED_RECIPE_MARKETPLACE,
  SEED_RECIPE_PRESETS,
  SEED_RECIPE_SOCIAL,
  SEED_RECIPES,
  SEED_SHOT_LISTS,
} from "@/domain/seed";
export {
  ExactKind,
  exactKindMatchesFill,
  RenderStyle,
  ShotList,
  ShotSlot,
  ShotSlotFields,
  SlotFill,
  sceneSlots,
} from "@/domain/shot-list";
export { BaseUnderstanding } from "@/domain/understanding";
