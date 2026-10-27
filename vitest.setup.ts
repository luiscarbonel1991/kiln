// Tests never make a paid call: the provider keys are dropped before any
// module reads the environment, so every adapter takes its key-free path even
// when the shell exports a real key.
delete process.env.OPENAI_API_KEY;
delete process.env.GOOGLE_API_KEY;

// Nor a call to Etsy; and what a test seals uses a key of its own.
delete process.env.ETSY_API_KEY;
delete process.env.ETSY_SHARED_SECRET;
delete process.env.ETSY_REDIRECT_URI;
process.env.KILN_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
