// Single source-of-truth color map for all bot names.
// Used identically in: chart bars, legend pills, tooltip swatches, Top Crawlers avatars.
import type { BotName } from "@/lib/types";

export const BOT_COLORS: Record<BotName, string> = {
  GPTBot: "#10a37f",           // OpenAI green
  "ChatGPT-User": "#1d9bf0",   // bright blue
  "OAI-SearchBot": "#6366f1",  // indigo
  ClaudeBot: "#d97706",        // amber (Anthropic)
  PerplexityBot: "#7c3aed",    // violet
  "Perplexity-User": "#a855f7",// purple-light
  "Google-Extended": "#ea4335",// Google red
};

// Display metadata for each bot — name + parent company
export const BOT_META: Record<BotName, { displayName: string; parent: string; initial: string }> = {
  GPTBot: { displayName: "GPTBot", parent: "OpenAI", initial: "G" },
  "ChatGPT-User": { displayName: "ChatGPT-User", parent: "OpenAI", initial: "C" },
  "OAI-SearchBot": { displayName: "OAI-SearchBot", parent: "OpenAI", initial: "O" },
  ClaudeBot: { displayName: "ClaudeBot", parent: "Anthropic", initial: "C" },
  PerplexityBot: { displayName: "PerplexityBot", parent: "Perplexity", initial: "P" },
  "Perplexity-User": { displayName: "Perplexity-User", parent: "Perplexity", initial: "P" },
  "Google-Extended": { displayName: "Google-Extended", parent: "Google", initial: "G" },
};
