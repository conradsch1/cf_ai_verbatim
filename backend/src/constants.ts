/** Workers AI model IDs — single `[ai]` binding; pick model per call via `env.AI.run(...)`. */
export const WORKERS_AI_LLAMA_3_3 =
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;
export const WORKERS_AI_WHISPER =
  "@cf/openai/whisper-large-v3-turbo" as const;
