// Tests never make a paid call: the provider keys are dropped before any
// module reads the environment, so every adapter takes its key-free path even
// when the shell exports a real key.
delete process.env.OPENAI_API_KEY;
delete process.env.GOOGLE_API_KEY;
