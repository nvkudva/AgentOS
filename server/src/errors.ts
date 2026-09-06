/** Raised when an agent reaches outside its room. Always logged, always fails the step. */
export class ScopeViolation extends Error {
  constructor(public roomKey: string, public attempted: string, msg?: string) {
    super(msg ?? `room "${roomKey}" is not scoped for ${attempted}`);
    this.name = 'ScopeViolation';
  }
}
/** Raised when a tool call needs the human. The step is parked, not failed. */
export class NeedsApproval extends Error {
  constructor(public approvalId: string, public action: string) {
    super(`awaiting approval: ${action}`);
    this.name = 'NeedsApproval';
  }
}
/** Raised when a spend cap would be overrun. Work halts; it never overruns. */
export class BudgetExceeded extends Error {
  constructor(public scope: 'room' | 'global' | 'run', public detail: string) {
    super(`${scope} budget exceeded: ${detail}`);
    this.name = 'BudgetExceeded';
  }
}
