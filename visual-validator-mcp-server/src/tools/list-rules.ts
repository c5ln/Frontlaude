import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { RuleEngine } from "../rules/engine.js";

export const LIST_RULES_TOOL = {
  name: "vv_list_rules",
  description: "List all available visual validation rules with their descriptions.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
} as const;

export function handleListRules(ruleEngine: RuleEngine): CallToolResult {
  const rules = ruleEngine.listRules();
  return {
    content: [
      {
        type: "text",
        text: rules.map((r) => `- **${r.id}**: ${r.description}`).join("\n"),
      },
    ],
  };
}
