// The chat eval runs the real text model, so its keys and database come from
// .env (never printed); the test run's setup drops the keys instead.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env: the eval says what it would cost and that it cannot run.
}
