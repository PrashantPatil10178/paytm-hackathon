/**
 * Two model tiers for the agents, each a VoltAgent "provider/model" string read from the repo-root .env:
 *
 * - lite (sales, leads): rule-based scoring and triage of one record at a time.
 *   AGENT_MODEL_LITE, else AGENT_MODEL, else COPILOT_MODEL, else openai/gpt-5.6-luna.
 *   openai/* runs on Azure OpenAI with OPENAI_BASE_URL + OPENAI_API_KEY.
 * - heavy (support, analysis): money and policy decisions with customers, reasoning across every dataset.
 *   AGENT_MODEL_HEAVY, else anthropic/claude-sonnet-5. anthropic/* needs ANTHROPIC_API_KEY
 *   (CLAUDE_API_KEY is accepted too).
 *
 * The agents set no temperature: current Claude models reject sampling parameters.
 */

// VoltAgent's model router reads ANTHROPIC_API_KEY; accept the name this repo's .env uses as well.
if (!process.env.ANTHROPIC_API_KEY && process.env.CLAUDE_API_KEY) process.env.ANTHROPIC_API_KEY = process.env.CLAUDE_API_KEY;

export const MODELS = {
  lite: process.env.AGENT_MODEL_LITE || process.env.AGENT_MODEL || process.env.COPILOT_MODEL || "openai/gpt-5.6-luna",
  heavy: process.env.AGENT_MODEL_HEAVY || "anthropic/claude-sonnet-5",
} as const;

/** The env var holding the API key a "provider/model" string needs. */
export function keyVar(model: string): string {
  const provider = model.split(/[:/]/)[0]!.toLowerCase();
  return provider === "openai" ? "OPENAI_API_KEY" : provider === "anthropic" ? "ANTHROPIC_API_KEY" : `${provider.toUpperCase()}_API_KEY`;
}

export const hasKey = (model: string) => Boolean(process.env[keyVar(model)]);
