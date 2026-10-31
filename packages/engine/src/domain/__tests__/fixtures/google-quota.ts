// Google's 429 (RESOURCE_EXHAUSTED) in the shape the Gemini API answers it:
// the message lists what was exceeded, the QuotaFailure detail names it.
// Gemini 4 Argon's 429 on Luis's key (2026-10-31) began with this message.
export function googleQuotaBody(violation: {
  metric: string;
  quotaId: string;
  model: string;
  limit: number;
}) {
  const { metric, quotaId, model, limit } = violation;
  return {
    error: {
      code: 429,
      message: `You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. \n* Quota exceeded for metric: ${metric}, limit: ${limit}, model: ${model}\nPlease retry in 41.6s.`,
      status: "RESOURCE_EXHAUSTED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.Help",
          links: [
            {
              description: "Learn more about Gemini API quotas",
              url: "https://ai.google.dev/gemini-api/docs/rate-limits",
            },
          ],
        },
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [
            {
              quotaMetric: metric,
              quotaId,
              quotaDimensions: { location: "global", model },
              quotaValue: String(limit),
            },
          ],
        },
        {
          "@type": "type.googleapis.com/google.rpc.RetryInfo",
          retryDelay: "41s",
        },
      ],
    },
  };
}

type Body = ReturnType<typeof googleQuotaBody>;

export const ARGON_FREE_TIER = googleQuotaBody({
  metric:
    "generativelanguage.googleapis.com/generate_content_free_tier_requests",
  quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
  model: "gemini-4-argon",
  limit: 0,
});

export const ARGON_PAID_NONE = googleQuotaBody({
  metric:
    "generativelanguage.googleapis.com/generate_content_paid_tier_requests",
  quotaId: "GenerateRequestsPerMinutePerProjectPerModel",
  model: "gemini-4-argon",
  limit: 0,
});

export const FLASH_PER_MINUTE = googleQuotaBody({
  metric:
    "generativelanguage.googleapis.com/generate_content_paid_tier_requests",
  quotaId: "GenerateRequestsPerMinutePerProjectPerModel",
  model: "gemini-3.6-flash",
  limit: 1000,
});

export const FLASH_PER_DAY = googleQuotaBody({
  metric:
    "generativelanguage.googleapis.com/generate_content_free_tier_requests",
  quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
  model: "gemini-3.6-flash",
  limit: 250,
});

// As Google's SDK throws it: the whole body in the message.
export const fromGoogleSdk = (body: Body) =>
  Object.assign(new Error(JSON.stringify(body)), { status: 429 });

// As the chat sees it after answeredError: the provider's words in the
// message, the AI SDK's error, body and all, on the cause.
export const fromChat = (body: Body) =>
  Object.assign(new Error(body.error.message), {
    status: 429,
    cause: Object.assign(new Error("Too Many Requests"), {
      statusCode: 429,
      responseBody: JSON.stringify(body),
    }),
  });
