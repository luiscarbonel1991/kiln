-- The work a chat's paid tools ran before a job named its conversation.
-- Each tool call is recorded once it ends (`at`) with how long it took
-- (`ms`), so what it queued or called was made inside that window.

-- generate and draw: the batch queued for the quote's project during the call.
UPDATE "GenerationJob" j
SET "sessionId" = t."sessionId"
FROM "ToolCall" t
JOIN "SpendQuote" q ON q."id" = t."quoteId"
JOIN "GenerationBatch" b ON b."makerId" = t."makerId"
  AND b."projectId" = q."input"->>'project'
  AND b."createdAt" BETWEEN t."at" - make_interval(secs => t."ms" / 1000.0) - interval '1 second'
    AND t."at"
WHERE t."sessionId" IS NOT NULL
  AND t."tool" IN ('generate', 'draw')
  AND j."batchId" = b."id"
  AND j."sessionId" IS NULL;

-- write_listing and review_product: the direct calls made during the call.
-- The margin is short: the chat's own step opened its call just before.
UPDATE "GenerationJob" j
SET "sessionId" = t."sessionId"
FROM "ToolCall" t
WHERE t."sessionId" IS NOT NULL
  AND t."tool" IN ('write_listing', 'review_product')
  AND j."makerId" = t."makerId"
  AND j."cardId" = 'direct'
  AND j."createdAt" BETWEEN t."at" - make_interval(secs => t."ms" / 1000.0) - interval '100 milliseconds'
    AND t."at"
  AND j."sessionId" IS NULL;
