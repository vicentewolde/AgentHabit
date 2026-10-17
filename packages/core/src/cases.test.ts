import { assert, describe, expect, it } from "vitest";
import {
  type AmountRef,
  buildCaseFixture,
  type CaseStep,
  type Owner,
  serializeCaseFixture,
  VALIDATION_ORDER,
} from "./cases.js";
import type { PositionState } from "./chain-adapter.js";
import { CONTRACT_ERRORS, FOREIGN_FAILURES } from "./contract-errors.js";
import { hasErrorCode } from "./errors.js";
import { type ContractParams, usdcToUnits, validateParams } from "./limits.js";
import { currentWeek, isReleaseOpen, isSettleOpen } from "./week.js";

const fixture = buildCaseFixture();
const knownFailures = new Set<string>([
  ...CONTRACT_ERRORS.map((error) => error.name),
  ...FOREIGN_FAILURES,
]);

/** A commit step's amount reference; any other step has none, and asking for it is a table bug. */
function amountRefOf(step: CaseStep): AmountRef {
  if (step.amount === "") assert.fail(`${step.action} step has no amount`);
  return step.amount;
}

/**
 * A reference model of spec 4.2 built only from the core arithmetic. It runs the table the way
 * the Rust and Foundry runners do, so a wrong expectation fails here before it reaches a chain.
 */
class ReferenceContract {
  readonly params: ContractParams;
  readonly positions = new Map<string, { state: PositionState; amount: bigint; goalM: bigint }>();
  readonly balances = new Map<string, bigint>([
    ["user", usdcToUnits(1_000n, "stellar")],
    ["stranger", usdcToUnits(1_000n, "stellar")],
    ["contract", 0n],
  ]);
  readonly blocked = new Set<Owner>();
  totalForfeited = 0n;

  constructor() {
    const config = fixture.config;
    this.params = {
      weekAnchor: BigInt(config.week_anchor),
      weekLen: BigInt(config.week_len),
      grace: BigInt(config.grace),
      staleAfter: BigInt(config.stale_after),
      minAmount: usdcToUnits(BigInt(config.min_amount_usdc), "stellar"),
      maxAmount: usdcToUnits(BigInt(config.max_amount_usdc), "stellar"),
      minGoalM: BigInt(config.min_goal_m),
      maxGoalM: BigInt(config.max_goal_m),
    };
  }

  amountOf(ref: AmountRef): bigint {
    const { minAmount, maxAmount } = this.params;
    const amounts: Record<AmountRef, bigint> = {
      above_max: maxAmount + 1n,
      below_min: minAmount - 1n,
      max: maxAmount,
      mid: (minAmount + maxAmount) / 2n,
      min: minAmount,
      zero: 0n,
    };
    return amounts[ref];
  }

  position(owner: Owner, weekId: bigint) {
    return (
      this.positions.get(`${owner}:${weekId}`) ?? { state: "None" as const, amount: 0n, goalM: 0n }
    );
  }

  balance(account: string): bigint {
    return this.balances.get(account) ?? 0n;
  }

  move(from: string, to: string, amount: bigint): void {
    this.balances.set(from, this.balance(from) - amount);
    this.balances.set(to, this.balance(to) + amount);
  }

  /** Returns the failure name, or the `current_week` result, or "" on success. */
  run(step: CaseStep): { failure: string; result: string } {
    const now = BigInt(step.time);
    const weekId = BigInt(step.week_id);
    const owner = step.owner;
    const key = `${owner}:${weekId}`;
    const fail = (failure: string) => ({ failure, result: "" });

    switch (step.action) {
      case "block":
        this.blocked.add(owner);
        return fail("");
      case "unblock":
        this.blocked.delete(owner);
        return fail("");
      case "current_week":
        if (now < this.params.weekAnchor) return fail("BeforeAnchor");
        return { failure: "", result: currentWeek(now, this.params).toString() };
      case "commit": {
        if (now < this.params.weekAnchor) return fail("BeforeAnchor");
        if (step.actor !== owner) return fail("Unauthorized");
        if (this.position(owner, weekId).state !== "None") return fail("AlreadyCommitted");
        if (weekId !== currentWeek(now, this.params) + 1n) return fail("WrongWeek");
        const amount = this.amountOf(amountRefOf(step));
        if (amount < this.params.minAmount || amount > this.params.maxAmount) {
          return fail("AmountOutOfRange");
        }
        const goal = BigInt(step.goal_m);
        if (goal < this.params.minGoalM || goal > this.params.maxGoalM) {
          return fail("GoalOutOfRange");
        }
        if (this.blocked.has(owner)) return fail("TokenFailure");
        this.move(owner, "contract", amount);
        this.positions.set(key, { state: "Active", amount, goalM: goal });
        return fail("");
      }
      case "settle": {
        if (step.actor !== "oracle") return fail("Unauthorized");
        const position = this.position(owner, weekId);
        if (position.state === "None") return fail("PositionNotFound");
        if (position.state !== "Active") return fail("PositionNotActive");
        if (!isSettleOpen(now, weekId, this.params)) return fail("OutsideSettleWindow");
        if (step.met === "true") {
          if (this.blocked.has(owner)) return fail("TokenFailure");
          this.move("contract", owner, position.amount);
          this.positions.set(key, { ...position, state: "Returned" });
        } else {
          this.totalForfeited += position.amount;
          this.positions.set(key, { ...position, state: "Forfeited" });
        }
        return fail("");
      }
      case "release_if_stale": {
        const position = this.position(owner, weekId);
        if (position.state === "None") return fail("PositionNotFound");
        if (position.state !== "Active") return fail("PositionNotActive");
        if (!isReleaseOpen(now, weekId, this.params)) return fail("NotStaleYet");
        if (this.blocked.has(owner)) return fail("TokenFailure");
        this.move("contract", owner, position.amount);
        this.positions.set(key, { ...position, state: "ReleasedStale" });
        return fail("");
      }
    }
  }
}

describe("the shared case table", () => {
  for (const contractCase of fixture.cases) {
    it(`holds in the reference model: ${contractCase.name}`, () => {
      const model = new ReferenceContract();
      let previousTime = -1n;

      contractCase.steps.forEach((step, index) => {
        const label = `${contractCase.name} step ${index} (${step.action})`;
        const now = BigInt(step.time);
        expect(now >= previousTime, `${label}: time goes backwards`).toBe(true);
        previousTime = now;

        const weekId = BigInt(step.week_id);
        const ownerBefore = model.balance(step.owner);
        const forfeitedBefore = model.totalForfeited;
        const { failure, result } = model.run(step);
        const position = model.position(step.owner, weekId);

        expect(failure, label).toBe(step.error);
        expect(result, label).toBe(step.result);
        expect(position.state, label).toBe(step.state);
        if (step.action === "commit" && step.error === "") {
          expect(position.amount, `${label}: stored amount`).toBe(
            model.amountOf(amountRefOf(step)),
          );
          expect(position.goalM, `${label}: stored goal`).toBe(BigInt(step.goal_m));
        }

        const ownerDelta = model.balance(step.owner) - ownerBefore;
        const expectedOwnerDelta = {
          credited: position.amount,
          debited: -position.amount,
          unchanged: 0n,
        }[step.owner_balance];
        expect(ownerDelta, `${label}: owner balance`).toBe(expectedOwnerDelta);

        const forfeitedDelta = model.totalForfeited - forfeitedBefore;
        expect(forfeitedDelta, `${label}: forfeited`).toBe(
          step.forfeited === "increased" ? position.amount : 0n,
        );

        let active = 0n;
        for (const held of model.positions.values()) {
          if (held.state === "Active") active += held.amount;
        }
        expect(model.balance("contract"), `${label}: balance invariant`).toBe(
          active + model.totalForfeited,
        );
      });
    });
  }

  it("names only known failures", () => {
    for (const contractCase of fixture.cases) {
      for (const step of contractCase.steps) {
        if (step.error !== "") expect(knownFailures.has(step.error), step.error).toBe(true);
      }
    }
    for (const order of Object.values(VALIDATION_ORDER)) {
      for (const failure of order) expect(knownFailures.has(failure), failure).toBe(true);
    }
  });

  it("exercises every runtime failure except the fee-on-transfer check", () => {
    const seen = new Set<string>(fixture.cases.flatMap((c) => c.steps.map((step) => step.error)));
    // BalanceMismatch needs a token that charges a fee: the SAC never does, so it is an
    // EVM-only test. InvalidConfig belongs to the constructor cases.
    const runtime = [...knownFailures].filter(
      (name) => name !== "BalanceMismatch" && name !== "InvalidConfig",
    );
    for (const name of runtime) expect(seen.has(name), name).toBe(true);
  });

  it("has unique case names", () => {
    const names = [...fixture.cases, ...fixture.constructor_cases].map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("matches validateParams on every constructor case", () => {
    for (const ctor of fixture.constructor_cases) {
      let error: unknown;
      try {
        validateParams({
          weekAnchor: BigInt(ctor.week_anchor),
          weekLen: BigInt(ctor.week_len),
          grace: BigInt(ctor.grace),
          staleAfter: BigInt(ctor.stale_after),
          minAmount: usdcToUnits(BigInt(ctor.min_amount_usdc), "avalanche"),
          maxAmount: usdcToUnits(BigInt(ctor.max_amount_usdc), "avalanche"),
          minGoalM: BigInt(ctor.min_goal_m),
          maxGoalM: BigInt(ctor.max_goal_m),
        });
      } catch (caught) {
        error = caught;
      }
      expect(hasErrorCode(error, "InvalidConfig") ? "InvalidConfig" : "", ctor.name).toBe(
        ctor.error,
      );
    }
  });
});

describe("serializeCaseFixture", () => {
  it("sorts keys at every level and ends with a newline", () => {
    const json = serializeCaseFixture(fixture);
    const firstStep = JSON.parse(json).cases[0].steps[0];

    expect(Object.keys(firstStep)).toEqual([...Object.keys(firstStep)].sort());
    expect(json.endsWith("}\n")).toBe(true);
  });

  it("keeps every step value a string, as Foundry's JSON cheatcodes need", () => {
    for (const contractCase of fixture.cases) {
      for (const step of contractCase.steps) {
        for (const value of Object.values(step)) expect(typeof value).toBe("string");
      }
    }
  });
});
