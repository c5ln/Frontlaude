import { BaseRule } from "./base-rule.js";
import { RuleResult } from "../types.js";

export class RuleEngine {
  constructor(private readonly rules: BaseRule[]) {}

  async run(pngBuffer: Buffer, filter?: string[]): Promise<RuleResult[]> {
    const active = filter
      ? this.rules.filter((r) => filter.includes(r.id))
      : this.rules;

    return Promise.all(
      active.map((r) =>
        r.run(pngBuffer).catch((err: Error) => ({
          rule: r.id,
          severity: "error" as const,
          message: `Rule execution failed: ${err.message}`,
          affectedRegions: [],
          details: { error: err.message },
        }))
      )
    );
  }

  listRules(): Array<{ id: string; description: string }> {
    return this.rules.map((r) => ({ id: r.id, description: r.description }));
  }
}
