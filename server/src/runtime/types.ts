export type Blast = 'low' | 'medium' | 'high';

export type Room = {
  id: string; key: string; name: string; objective: string;
  x: number; y: number; w: number; h: number;
  budget_cents: number; spent_cents: number;
  tool_grants: string[]; approval_policy: Record<Blast, 'auto' | 'approve'>;
  db_role: string | null; status: 'open' | 'halted' | 'capped';
};
export type Agent = {
  id: string; room_id: string; name: string; role: string; policy_key: string;
  state: 'idle' | 'working' | 'blocked' | 'awaiting_approval' | 'failed' | 'killed';
  activity: string; current_run_id: string | null;
  step_budget: number; cost_budget_cents: number; steps_used: number; spent_cents: number;
};
export type Run = {
  id: string; agent_id: string; room_id: string; goal: string;
  status: string; steps_used: number; spent_cents: number;
  kill_reason: string | null; scratch: Record<string, any>;
};

/** Everything a tool call knows. Note it carries the ROOM, never a global handle. */
export type Ctx = {
  room: Room; agent: Agent; run: Run;
  approvalId?: string;           // set when re-executing after the human approved
  say: (activity: string) => Promise<void>;
};

export type ToolSpec = {
  name: string;
  blast: Blast;
  reversible: boolean;
  external: boolean;
  /** Plain-words description of the action, for the approval card. */
  summary: (args: any) => string;
  /** What this call touches: repo/branch, tables, endpoints, queues. */
  touches: (args: any) => string[];
  /** Estimated cost in cents, charged before the call and trued up after. */
  estimate: (args: any) => number;
  run: (ctx: Ctx, args: any) => Promise<any>;
};
