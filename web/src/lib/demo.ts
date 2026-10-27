import type { Snapshot } from './api';

/**
 * The desk, frozen. The hosted demo has no server behind it — no Postgres, no
 * scheduler, no agents — so this is what it shows instead: real seeded rooms and
 * crews, captured from a running instance. Every interaction is the real one; only
 * the data underneath is standing still.
 */
export const DEMO: Snapshot = {
  "rooms": [
    {
      "id": "room_366519d8b1ca",
      "key": "engineering",
      "name": "Engineering",
      "objective": "Keep the Copper Cup ordering site fast and green",
      "x": 0,
      "y": 0,
      "w": 2,
      "h": 1,
      "budget_cents": 400,
      "spent_cents": 13,
      "tool_grants": [
        "repo.read",
        "repo.patch",
        "repo.test",
        "github.pr.open",
        "artifact.write",
        "escalate",
        "assign",
        "report",
        "clarify"
      ],
      "approval_policy": {
        "low": "auto",
        "high": "approve",
        "medium": "auto"
      },
      "db_role": null,
      "status": "open",
      "color": "#7b91ea",
      "icon": "⌘"
    },
    {
      "id": "room_1a7f30408fbc",
      "key": "analytics",
      "name": "Analytics",
      "objective": "Answer questions from the till and the website",
      "x": 2,
      "y": 0,
      "w": 2,
      "h": 1,
      "budget_cents": 300,
      "spent_cents": 114,
      "tool_grants": [
        "sql.query",
        "artifact.write",
        "artifact.read",
        "escalate",
        "assign",
        "report",
        "clarify"
      ],
      "approval_policy": {
        "low": "auto",
        "high": "approve",
        "medium": "auto"
      },
      "db_role": "atrium_analytics",
      "status": "open",
      "color": "#34a2c2",
      "icon": "◈"
    },
    {
      "id": "room_45dc31b85bfd",
      "key": "marketing",
      "name": "Marketing",
      "objective": "Fill the café on slow afternoons",
      "x": 0,
      "y": 1,
      "w": 2,
      "h": 1,
      "budget_cents": 200,
      "spent_cents": 14,
      "tool_grants": [
        "queue.draft",
        "queue.publish",
        "artifact.read",
        "artifact.write",
        "escalate",
        "assign",
        "report",
        "clarify"
      ],
      "approval_policy": {
        "low": "auto",
        "high": "approve",
        "medium": "auto"
      },
      "db_role": null,
      "status": "open",
      "color": "#db7d54",
      "icon": "✎"
    },
    {
      "id": "room_db4c56c3bf69",
      "key": "sales",
      "name": "Sales",
      "objective": "Sign offices up for weekly bean delivery",
      "x": 2,
      "y": 1,
      "w": 2,
      "h": 1,
      "budget_cents": 200,
      "spent_cents": 4,
      "tool_grants": [
        "sql.query",
        "crm.note",
        "artifact.write",
        "escalate",
        "assign",
        "report",
        "clarify"
      ],
      "approval_policy": {
        "low": "auto",
        "high": "approve",
        "medium": "auto"
      },
      "db_role": "atrium_sales",
      "status": "open",
      "color": "#34a977",
      "icon": "◎"
    },
    {
      "id": "room_7ddf9205542d",
      "key": "support",
      "name": "Support",
      "objective": "Answer customers before they chase us",
      "x": 0,
      "y": 2,
      "w": 2,
      "h": 1,
      "budget_cents": 250,
      "spent_cents": 2,
      "tool_grants": [
        "ticket.list",
        "ticket.reply",
        "artifact.write",
        "escalate",
        "assign",
        "report",
        "clarify"
      ],
      "approval_policy": {
        "low": "auto",
        "high": "approve",
        "medium": "auto"
      },
      "db_role": "atrium_support",
      "status": "open",
      "color": "#e56f9a",
      "icon": "☎"
    },
    {
      "id": "room_37f9cff4ad76",
      "key": "finance",
      "name": "Finance",
      "objective": "Close the month and watch the food cost",
      "x": 2,
      "y": 2,
      "w": 2,
      "h": 1,
      "budget_cents": 250,
      "spent_cents": 16,
      "tool_grants": [
        "sql.query",
        "artifact.write",
        "artifact.read",
        "escalate",
        "assign",
        "report",
        "clarify"
      ],
      "approval_policy": {
        "low": "auto",
        "high": "approve",
        "medium": "auto"
      },
      "db_role": "atrium_finance",
      "status": "open",
      "color": "#b29239",
      "icon": "⛁"
    },
    {
      "id": "room_bd5742dc4f6a",
      "key": "research",
      "name": "Research",
      "objective": "Taste what is next on the menu",
      "x": 0,
      "y": 3,
      "w": 2,
      "h": 1,
      "budget_cents": 180,
      "spent_cents": 12,
      "tool_grants": [
        "artifact.read",
        "artifact.write",
        "sql.query",
        "escalate",
        "assign",
        "report",
        "clarify"
      ],
      "approval_policy": {
        "low": "auto",
        "high": "approve",
        "medium": "auto"
      },
      "db_role": "atrium_research",
      "status": "open",
      "color": "#8491dc",
      "icon": "◍"
    }
  ],
  "agents": [
    {
      "id": "agt_482ca98ceadf",
      "room_id": "room_1a7f30408fbc",
      "name": "Vera",
      "role": "manager",
      "policy_key": "room.manager",
      "state": "idle",
      "activity": "done",
      "step_budget": 300,
      "cost_budget_cents": 60,
      "steps_used": 14,
      "spent_cents": 0,
      "persona": "Runs Analytics. Breaks what you ask for into tasks, hands them out, and reports back.",
      "color": "#4bb3d4",
      "avatar": "◆",
      "tier": "manager"
    },
    {
      "id": "agt_0525bcb1b92b",
      "room_id": "room_1a7f30408fbc",
      "name": "Ada",
      "role": "analyst",
      "policy_key": "analytics.weekly",
      "state": "idle",
      "activity": "done",
      "step_budget": 40,
      "cost_budget_cents": 120,
      "steps_used": 4,
      "spent_cents": 3,
      "persona": "Cautious. Will not state a number she has not queried twice.",
      "color": "#4bb3d4",
      "avatar": "👩‍🔬",
      "tier": "worker"
    },
    {
      "id": "agt_430eefa475d0",
      "room_id": "room_1a7f30408fbc",
      "name": "Bo",
      "role": "analyst",
      "policy_key": "analytics.weekly",
      "state": "idle",
      "activity": "done",
      "step_budget": 40,
      "cost_budget_cents": 120,
      "steps_used": 4,
      "spent_cents": 3,
      "persona": "Fast and rough. Good for a first read of the morning rush, never the final one.",
      "color": "#63c9c0",
      "avatar": "🧑‍🔬",
      "tier": "worker"
    },
    {
      "id": "agt_4704a527013f",
      "room_id": "room_366519d8b1ca",
      "name": "Otto",
      "role": "manager",
      "policy_key": "room.manager",
      "state": "idle",
      "activity": "handed over",
      "step_budget": 300,
      "cost_budget_cents": 60,
      "steps_used": 10,
      "spent_cents": 0,
      "persona": "Runs Engineering. Breaks what you ask for into tasks, hands them out, and reports back.",
      "color": "#6f8ef5",
      "avatar": "🧑‍💼",
      "tier": "manager"
    },
    {
      "id": "agt_5944c95b2e8e",
      "room_id": "room_366519d8b1ca",
      "name": "Kit",
      "role": "engineer",
      "policy_key": "engineering.fix",
      "state": "idle",
      "activity": "done",
      "step_budget": 40,
      "cost_budget_cents": 120,
      "steps_used": 7,
      "spent_cents": 13,
      "persona": "Small diffs, real tests, no heroics. Refuses to ship a red checkout page.",
      "color": "#6f8ef5",
      "avatar": "👨‍💻",
      "tier": "worker"
    },
    {
      "id": "agt_1211e62a0082",
      "room_id": "room_366519d8b1ca",
      "name": "Rex",
      "role": "engineer",
      "policy_key": "demo.loop",
      "state": "idle",
      "activity": "",
      "step_budget": 6,
      "cost_budget_cents": 4,
      "steps_used": 3,
      "spent_cents": 0,
      "persona": "Gets stuck in loops on purpose. He exists to prove the kill switch works.",
      "color": "#8a93a5",
      "avatar": "🧑‍💻",
      "tier": "worker"
    },
    {
      "id": "agt_21f7ae7e6002",
      "room_id": "room_37f9cff4ad76",
      "name": "Hugo",
      "role": "manager",
      "policy_key": "room.manager",
      "state": "idle",
      "activity": "done",
      "step_budget": 300,
      "cost_budget_cents": 60,
      "steps_used": 11,
      "spent_cents": 0,
      "persona": "Runs Finance. Breaks what you ask for into tasks, hands them out, and reports back.",
      "color": "#c9a227",
      "avatar": "🧑‍💼",
      "tier": "manager"
    },
    {
      "id": "agt_707273e2c656",
      "room_id": "room_37f9cff4ad76",
      "name": "Fay",
      "role": "controller",
      "policy_key": "finance.close",
      "state": "idle",
      "activity": "done",
      "step_budget": 40,
      "cost_budget_cents": 120,
      "steps_used": 3,
      "spent_cents": 2,
      "persona": "Ties every number to a till row. Will not round in your favour.",
      "color": "#c9a227",
      "avatar": "👩‍⚖️",
      "tier": "worker"
    },
    {
      "id": "agt_20fd3a618c0f",
      "room_id": "room_37f9cff4ad76",
      "name": "Gus",
      "role": "analyst",
      "policy_key": "finance.close",
      "state": "idle",
      "activity": "done",
      "step_budget": 40,
      "cost_budget_cents": 120,
      "steps_used": 3,
      "spent_cents": 2,
      "persona": "Looks for the line that moved — usually oat milk — and asks why.",
      "color": "#d9b64a",
      "avatar": "👨‍🏫",
      "tier": "worker"
    },
    {
      "id": "agt_11541093df36",
      "room_id": "room_45dc31b85bfd",
      "name": "Juno",
      "role": "manager",
      "policy_key": "room.manager",
      "state": "idle",
      "activity": "",
      "step_budget": 300,
      "cost_budget_cents": 60,
      "steps_used": 300,
      "spent_cents": 0,
      "persona": "Runs Marketing. Breaks what you ask for into tasks, hands them out, and reports back.",
      "color": "#e0794b",
      "avatar": "🧑‍💼",
      "tier": "manager"
    },
    {
      "id": "agt_a00189646174",
      "room_id": "room_45dc31b85bfd",
      "name": "Mel",
      "role": "writer",
      "policy_key": "marketing.launch",
      "state": "idle",
      "activity": "done",
      "step_budget": 40,
      "cost_budget_cents": 120,
      "steps_used": 4,
      "spent_cents": 6,
      "persona": "Writes plainly, cites the analytics room, never publishes without asking.",
      "color": "#e0794b",
      "avatar": "👩‍🎨",
      "tier": "worker"
    },
    {
      "id": "agt_df92974127df",
      "room_id": "room_45dc31b85bfd",
      "name": "Nia",
      "role": "editor",
      "policy_key": "marketing.launch",
      "state": "awaiting_approval",
      "activity": "waiting on you: publish queued post cq_44ddbe915958 to blog",
      "step_budget": 40,
      "cost_budget_cents": 120,
      "steps_used": 3,
      "spent_cents": 1,
      "persona": "Second pair of eyes. Cuts a draft by a third before it goes anywhere.",
      "color": "#d9a441",
      "avatar": "🧑‍🏫",
      "tier": "worker"
    },
    {
      "id": "agt_cfe9290eaed8",
      "room_id": "room_7ddf9205542d",
      "name": "Mira",
      "role": "manager",
      "policy_key": "room.manager",
      "state": "idle",
      "activity": "",
      "step_budget": 300,
      "cost_budget_cents": 60,
      "steps_used": 0,
      "spent_cents": 0,
      "persona": "Runs Support. Breaks what you ask for into tasks, hands them out, and reports back.",
      "color": "#e05b8f",
      "avatar": "🧑‍💼",
      "tier": "manager"
    },
    {
      "id": "agt_b3a96b064a24",
      "room_id": "room_7ddf9205542d",
      "name": "Ola",
      "role": "support",
      "policy_key": "support.triage",
      "state": "idle",
      "activity": "done",
      "step_budget": 40,
      "cost_budget_cents": 120,
      "steps_used": 5,
      "spent_cents": 1,
      "persona": "Reads the whole thread before replying. Slower, fewer follow-ups.",
      "color": "#d67aa8",
      "avatar": "💁‍♂️",
      "tier": "worker"
    },
    {
      "id": "agt_56b4316efe98",
      "room_id": "room_7ddf9205542d",
      "name": "Ren",
      "role": "support",
      "policy_key": "support.triage",
      "state": "idle",
      "activity": "done",
      "step_budget": 40,
      "cost_budget_cents": 120,
      "steps_used": 5,
      "spent_cents": 1,
      "persona": "Answers the oldest urgent thing first. Never promises a pickup date.",
      "color": "#e05b8f",
      "avatar": "💁",
      "tier": "worker"
    },
    {
      "id": "agt_693f560f583d",
      "room_id": "room_bd5742dc4f6a",
      "name": "Piet",
      "role": "manager",
      "policy_key": "room.manager",
      "state": "idle",
      "activity": "done",
      "step_budget": 300,
      "cost_budget_cents": 60,
      "steps_used": 15,
      "spent_cents": 0,
      "persona": "Runs Research. Breaks what you ask for into tasks, hands them out, and reports back.",
      "color": "#7f8cd6",
      "avatar": "🧑‍💼",
      "tier": "manager"
    },
    {
      "id": "agt_5080f4b050a0",
      "room_id": "room_bd5742dc4f6a",
      "name": "Val",
      "role": "researcher",
      "policy_key": "research.brief",
      "state": "idle",
      "activity": "done",
      "step_budget": 40,
      "cost_budget_cents": 120,
      "steps_used": 3,
      "spent_cents": 1,
      "persona": "Digs for the drink nobody asked about. Slow, occasionally right.",
      "color": "#7f8cd6",
      "avatar": "🕵️",
      "tier": "worker"
    },
    {
      "id": "agt_e73bf1cbcc5c",
      "room_id": "room_db4c56c3bf69",
      "name": "Cleo",
      "role": "manager",
      "policy_key": "room.manager",
      "state": "idle",
      "activity": "",
      "step_budget": 300,
      "cost_budget_cents": 60,
      "steps_used": 0,
      "spent_cents": 0,
      "persona": "Runs Sales. Breaks what you ask for into tasks, hands them out, and reports back.",
      "color": "#3fb27f",
      "avatar": "🧑‍💼",
      "tier": "manager"
    },
    {
      "id": "agt_794ac034835e",
      "room_id": "room_db4c56c3bf69",
      "name": "Sam",
      "role": "rep",
      "policy_key": "sales.hygiene",
      "state": "idle",
      "activity": "done",
      "step_budget": 40,
      "cost_budget_cents": 120,
      "steps_used": 3,
      "spent_cents": 2,
      "persona": "Pipeline janitor. Flags stale wholesale deals before they rot.",
      "color": "#3fb27f",
      "avatar": "🤵",
      "tier": "worker"
    },
    {
      "id": "agt_99ed37f3b1da",
      "room_id": "room_db4c56c3bf69",
      "name": "Tor",
      "role": "analyst",
      "policy_key": "sales.hygiene",
      "state": "idle",
      "activity": "done",
      "step_budget": 40,
      "cost_budget_cents": 120,
      "steps_used": 3,
      "spent_cents": 2,
      "persona": "Reads the pipeline as numbers, not stories. Blunt about which offices will never buy.",
      "color": "#57b6a0",
      "avatar": "👨‍🔬",
      "tier": "worker"
    }
  ],
  "inbox": [
    {
      "id": "apr_cb8e12b7fcbe",
      "room_key": "marketing",
      "room_name": "Marketing",
      "agent_name": "Nia",
      "kind": "approval",
      "action": "publish queued post cq_44ddbe915958 to blog",
      "blast_radius": "high",
      "est_cost_cents": 5,
      "run_spent_cents": 1,
      "touches": [
        "content_queue row cq_44ddbe915958",
        "public channel"
      ],
      "created_at": "2026-09-07T19:12:44.318Z",
      "mandate_id": "mnd_cc03",
      "args": {
        "id": "cq_44ddbe915958",
        "channel": "blog"
      }
    }
  ],
  "config": {
    "id": 1,
    "global_budget_cents": 5000,
    "global_spent_cents": 311,
    "panic_stop": false
  },
  "mandates": [
    {
      "id": "mnd_cc01",
      "text": "fix the oat-milk checkout total on the ordering site",
      "room_id": "room_366519d8b1ca",
      "state": "done",
      "color": "#6f8ef5",
      "quoted_cents": 120,
      "spent_cents": 13,
      "report": "Engineering fixed the oat surcharge and the tests are green.\nYou have “Checkout fix” in Engineering.",
      "artifact_id": null,
      "context": [],
      "created_at": "2026-09-08T01:22:44.397Z"
    },
    {
      "id": "mnd_cc02",
      "text": "rank the morning rush drinks by profit",
      "room_id": "room_1a7f30408fbc",
      "state": "done",
      "color": "#4bb3d4",
      "quoted_cents": 195,
      "spent_cents": 9,
      "report": "Analytics finished all 3 tasks.\nYou have “Morning rush read-out” in Analytics.",
      "artifact_id": null,
      "context": [],
      "created_at": "2026-09-08T00:22:44.397Z"
    },
    {
      "id": "mnd_cc03",
      "text": "write the two-for-one cortado post for slow Tuesdays",
      "room_id": "room_45dc31b85bfd",
      "state": "working",
      "color": "#e0794b",
      "quoted_cents": 191,
      "spent_cents": 0,
      "report": "",
      "artifact_id": null,
      "context": [],
      "created_at": "2026-09-07T19:10:44.318Z"
    },
    {
      "id": "mnd_cc04",
      "text": "chase the three stalled wholesale tastings",
      "room_id": "room_db4c56c3bf69",
      "state": "working",
      "color": "#3fb27f",
      "quoted_cents": 140,
      "spent_cents": 4,
      "report": "",
      "artifact_id": null,
      "context": [],
      "created_at": "2026-09-07T18:40:44.318Z"
    },
    {
      "id": "mnd_cc05",
      "text": "clear the overnight ticket queue",
      "room_id": "room_7ddf9205542d",
      "state": "done",
      "color": "#e05b8f",
      "quoted_cents": 110,
      "spent_cents": 2,
      "report": "Support answered the urgent tickets first.\nThe cake order is confirmed for Saturday.",
      "artifact_id": null,
      "context": [],
      "created_at": "2026-09-08T02:12:44.397Z"
    },
    {
      "id": "mnd_cc06",
      "text": "close September and explain the oat milk line",
      "room_id": "room_37f9cff4ad76",
      "state": "done",
      "color": "#c9a227",
      "quoted_cents": 160,
      "spent_cents": 6,
      "report": "Finance finished all 3 tasks.\nYou have “September close” in Finance.",
      "artifact_id": null,
      "context": [],
      "created_at": "2026-09-07T16:52:44.397Z"
    },
    {
      "id": "mnd_cc07",
      "text": "pick the winter drink",
      "room_id": "room_bd5742dc4f6a",
      "state": "done",
      "color": "#7f8cd6",
      "quoted_cents": 150,
      "spent_cents": 12,
      "report": "Research finished the tastings.\nYou have “Winter drink trials” in Research.",
      "artifact_id": null,
      "context": [],
      "created_at": "2026-09-07T15:48:44.225Z"
    },
    {
      "id": "mnd_cc08",
      "text": "push weekend pastry pre-orders on the site",
      "room_id": "room_45dc31b85bfd",
      "state": "done",
      "color": "#e0794b",
      "quoted_cents": 130,
      "spent_cents": 14,
      "report": "Marketing finished all 2 tasks.\nMorning buns sold out by nine — on purpose this time.",
      "artifact_id": null,
      "context": [],
      "created_at": "2026-09-07T12:10:44.318Z"
    }
  ],
  "tasks": [
    {
      "id": "task_cc01",
      "mandate_id": "mnd_cc01",
      "agent_id": "agt_5944c95b2e8e",
      "run_id": null,
      "title": "Reproduce the oat surcharge dropout",
      "state": "done",
      "ord": 0,
      "kill_reason": null
    },
    {
      "id": "task_cc02",
      "mandate_id": "mnd_cc01",
      "agent_id": "agt_5944c95b2e8e",
      "run_id": null,
      "title": "Patch the cart and keep the diff small",
      "state": "done",
      "ord": 0,
      "kill_reason": null
    },
    {
      "id": "task_cc03",
      "mandate_id": "mnd_cc01",
      "agent_id": "agt_5944c95b2e8e",
      "run_id": null,
      "title": "Run the checkout tests green",
      "state": "done",
      "ord": 0,
      "kill_reason": null
    },
    {
      "id": "task_cc04",
      "mandate_id": "mnd_cc02",
      "agent_id": "agt_430eefa475d0",
      "run_id": null,
      "title": "Pull the morning rush by drink",
      "state": "done",
      "ord": 0,
      "kill_reason": null
    },
    {
      "id": "task_cc05",
      "mandate_id": "mnd_cc02",
      "agent_id": "agt_0525bcb1b92b",
      "run_id": null,
      "title": "Split it by café and day, twice",
      "state": "done",
      "ord": 0,
      "kill_reason": null
    },
    {
      "id": "task_cc06",
      "mandate_id": "mnd_cc02",
      "agent_id": "agt_0525bcb1b92b",
      "run_id": null,
      "title": "Write the morning rush read-out",
      "state": "done",
      "ord": 0,
      "kill_reason": null
    },
    {
      "id": "task_cc07",
      "mandate_id": "mnd_cc03",
      "agent_id": "agt_a00189646174",
      "run_id": null,
      "title": "Draft the two-for-one cortado post",
      "state": "working",
      "ord": 0,
      "kill_reason": null
    },
    {
      "id": "task_cc08",
      "mandate_id": "mnd_cc03",
      "agent_id": "agt_df92974127df",
      "run_id": null,
      "title": "Cut it by a third and queue it for approval",
      "state": "queued",
      "ord": 0,
      "kill_reason": null
    },
    {
      "id": "task_cc09",
      "mandate_id": "mnd_cc04",
      "agent_id": "agt_794ac034835e",
      "run_id": null,
      "title": "Call back Hale & Co after the tasting",
      "state": "working",
      "ord": 0,
      "kill_reason": null
    },
    {
      "id": "task_cc10",
      "mandate_id": "mnd_cc04",
      "agent_id": "agt_99ed37f3b1da",
      "run_id": null,
      "title": "Score the stalled tastings honestly",
      "state": "working",
      "ord": 0,
      "kill_reason": null
    },
    {
      "id": "task_cc11",
      "mandate_id": "mnd_cc05",
      "agent_id": "agt_56b4316efe98",
      "run_id": null,
      "title": "Answer the sold-out-but-shelf-full ticket",
      "state": "done",
      "ord": 0,
      "kill_reason": null
    },
    {
      "id": "task_cc12",
      "mandate_id": "mnd_cc05",
      "agent_id": "agt_b3a96b064a24",
      "run_id": null,
      "title": "Confirm the Saturday cake pickup",
      "state": "done",
      "ord": 0,
      "kill_reason": null
    },
    {
      "id": "task_cc13",
      "mandate_id": "mnd_cc06",
      "agent_id": "agt_20fd3a618c0f",
      "run_id": null,
      "title": "Split the milk spend by café",
      "state": "done",
      "ord": 0,
      "kill_reason": null
    },
    {
      "id": "task_cc14",
      "mandate_id": "mnd_cc06",
      "agent_id": "agt_707273e2c656",
      "run_id": null,
      "title": "Tie the close to till rows",
      "state": "done",
      "ord": 0,
      "kill_reason": null
    },
    {
      "id": "task_cc15",
      "mandate_id": "mnd_cc07",
      "agent_id": "agt_5080f4b050a0",
      "run_id": null,
      "title": "Taste the cardamom oat latte with regulars",
      "state": "done",
      "ord": 0,
      "kill_reason": null
    },
    {
      "id": "task_cc16",
      "mandate_id": "mnd_cc07",
      "agent_id": "agt_5080f4b050a0",
      "run_id": null,
      "title": "Write up the winter drink trials",
      "state": "done",
      "ord": 0,
      "kill_reason": null
    },
    {
      "id": "task_cc17",
      "mandate_id": "mnd_cc08",
      "agent_id": "agt_a00189646174",
      "run_id": null,
      "title": "Draft the pastry pre-order post",
      "state": "done",
      "ord": 0,
      "kill_reason": null
    },
    {
      "id": "task_cc18",
      "mandate_id": "mnd_cc08",
      "agent_id": "agt_df92974127df",
      "run_id": null,
      "title": "Publish after the morning-bun photo landed",
      "state": "done",
      "ord": 0,
      "kill_reason": null
    }
  ]
};

export type ChatMsg = { who: string; avatar: string; color: string; text: string; time: string; kind: 'say' | 'sys' | 'ask' };
/** Frozen threads for the hosted demo: the same back-and-forth the live rooms get from events. */
export const DEMO_THREADS: Record<string, ChatMsg[]> = {
  "engineering": [
    {
      "who": "Otto",
      "avatar": "🧑‍💼",
      "color": "#6f8ef5",
      "text": "Morning crew — the oat-milk large latte is 500ing at checkout. That is real money every hour.",
      "time": "9:02 AM",
      "kind": "say"
    },
    {
      "who": "Kit",
      "avatar": "👨‍💻",
      "color": "#6f8ef5",
      "text": "Reproduced it: the oat surcharge line drops out of the cart when the size is large.",
      "time": "9:07 AM",
      "kind": "say"
    },
    {
      "who": "Rex",
      "avatar": "🧑‍💻",
      "color": "#8a93a5",
      "text": "I can reproduce it five different ways if that helps.",
      "time": "9:09 AM",
      "kind": "say"
    },
    {
      "who": "Kit",
      "avatar": "👨‍💻",
      "color": "#6f8ef5",
      "text": "One way is enough. The surcharge applies after the size multiplier — patch incoming.",
      "time": "9:14 AM",
      "kind": "say"
    },
    {
      "who": "",
      "avatar": "",
      "color": "",
      "text": "Kit read 3 files in the checkout code",
      "time": "9:14 AM",
      "kind": "sys"
    },
    {
      "who": "Kit",
      "avatar": "👨‍💻",
      "color": "#6f8ef5",
      "text": "Patch is up, eleven lines. Tests green, pushing behind the flag.",
      "time": "9:21 AM",
      "kind": "say"
    },
    {
      "who": "",
      "avatar": "",
      "color": "",
      "text": "All tests passed",
      "time": "9:22 AM",
      "kind": "sys"
    },
    {
      "who": "Rex",
      "avatar": "🧑‍💻",
      "color": "#8a93a5",
      "text": "Can I break it again, for science?",
      "time": "9:24 AM",
      "kind": "say"
    },
    {
      "who": "Kit",
      "avatar": "👨‍💻",
      "color": "#6f8ef5",
      "text": "No.",
      "time": "9:24 AM",
      "kind": "say"
    }
  ],
  "analytics": [
    {
      "who": "Vera",
      "avatar": "◆",
      "color": "#4bb3d4",
      "text": "Question for the room: which morning drinks actually make money?",
      "time": "8:40 AM",
      "kind": "say"
    },
    {
      "who": "Bo",
      "avatar": "🧑‍🔬",
      "color": "#63c9c0",
      "text": "Pulled the rush first: oat flat white outsells dairy two to one at riverside.",
      "time": "8:52 AM",
      "kind": "say"
    },
    {
      "who": "",
      "avatar": "",
      "color": "",
      "text": "Bo queried the till — found 214 records",
      "time": "8:53 AM",
      "kind": "sys"
    },
    {
      "who": "Ada",
      "avatar": "👩‍🔬",
      "color": "#4bb3d4",
      "text": "Ran it again by café and day. Same answer — and subscribers tip 30 percent more often.",
      "time": "9:05 AM",
      "kind": "say"
    },
    {
      "who": "Bo",
      "avatar": "🧑‍🔬",
      "color": "#63c9c0",
      "text": "So the menu board lies? Dairy gets top billing and sells half.",
      "time": "9:06 AM",
      "kind": "say"
    },
    {
      "who": "Ada",
      "avatar": "👩‍🔬",
      "color": "#4bb3d4",
      "text": "Top billing goes to oat from Monday. Wrote it up, numbers first, adjectives nowhere.",
      "time": "9:11 AM",
      "kind": "say"
    },
    {
      "who": "",
      "avatar": "",
      "color": "",
      "text": "Ada saved “Morning rush read-out” to files",
      "time": "9:12 AM",
      "kind": "sys"
    }
  ],
  "marketing": [
    {
      "who": "Juno",
      "avatar": "🧑‍💼",
      "color": "#e0794b",
      "text": "Slow Tuesdays at market. We need bodies in seats by three.",
      "time": "1:10 PM",
      "kind": "say"
    },
    {
      "who": "Mel",
      "avatar": "👩‍🎨",
      "color": "#e0794b",
      "text": "Drafting the two-for-one cortado post — using Ada’s rush numbers so it is not just vibes.",
      "time": "1:18 PM",
      "kind": "say"
    },
    {
      "who": "",
      "avatar": "",
      "color": "",
      "text": "Mel drafted a post for the blog",
      "time": "1:20 PM",
      "kind": "sys"
    },
    {
      "who": "Nia",
      "avatar": "🧑‍🏫",
      "color": "#d9a441",
      "text": "Cut it by a third and killed the exclamation marks. It can go the second you say.",
      "time": "1:31 PM",
      "kind": "say"
    },
    {
      "who": "Nia",
      "avatar": "🧑‍🏫",
      "color": "#d9a441",
      "text": "Needs your approval: publish the cortado post to the blog",
      "time": "1:31 PM",
      "kind": "ask"
    },
    {
      "who": "Mel",
      "avatar": "👩‍🎨",
      "color": "#e0794b",
      "text": "Holding for the photos. Yesterday’s cortado shot is perfect — give me an hour.",
      "time": "1:33 PM",
      "kind": "say"
    }
  ],
  "sales": [
    {
      "who": "Cleo",
      "avatar": "🧑‍💼",
      "color": "#3fb27f",
      "text": "Three tastings stalled. Who is actually still alive?",
      "time": "10:15 AM",
      "kind": "say"
    },
    {
      "who": "Sam",
      "avatar": "🤵",
      "color": "#3fb27f",
      "text": "Hale & Co went quiet after the tasting. Not dead, just quiet — flagging for Thursday.",
      "time": "10:19 AM",
      "kind": "say"
    },
    {
      "who": "Tor",
      "avatar": "👨‍🔬",
      "color": "#57b6a0",
      "text": "Numbers say otherwise: no reply in 21 days means dead. Move them to lost and stop watering them.",
      "time": "10:24 AM",
      "kind": "say"
    },
    {
      "who": "",
      "avatar": "",
      "color": "",
      "text": "Sam left a note on Hale & Co",
      "time": "10:26 AM",
      "kind": "sys"
    },
    {
      "who": "Sam",
      "avatar": "🤵",
      "color": "#3fb27f",
      "text": "Fine — moved to lost. But I am still bringing beans Thursday. Low pressure, high aroma.",
      "time": "10:27 AM",
      "kind": "say"
    },
    {
      "who": "Tor",
      "avatar": "👨‍🔬",
      "color": "#57b6a0",
      "text": "That is exactly watering a dead plant.",
      "time": "10:28 AM",
      "kind": "say"
    }
  ],
  "support": [
    {
      "who": "Mira",
      "avatar": "🧑‍💼",
      "color": "#e05b8f",
      "text": "Overnight queue first, crew. Cake ticket before ten — birthdays do not move.",
      "time": "8:05 AM",
      "kind": "say"
    },
    {
      "who": "Ren",
      "avatar": "💁",
      "color": "#e05b8f",
      "text": "Sold-out-but-shelf-full is the urgent one. That is a lost pre-order, answering first.",
      "time": "8:09 AM",
      "kind": "say"
    },
    {
      "who": "",
      "avatar": "",
      "color": "",
      "text": "Ren opened 4 open tickets",
      "time": "8:10 AM",
      "kind": "sys"
    },
    {
      "who": "Ola",
      "avatar": "💁‍♂️",
      "color": "#d67aa8",
      "text": "Took the thin flat white one. Grinder was recalibrated at nine, so I will say that and mean it.",
      "time": "8:22 AM",
      "kind": "say"
    },
    {
      "who": "Ren",
      "avatar": "💁",
      "color": "#e05b8f",
      "text": "Cake confirmed for Saturday ten, flagship. Asked the time, never promised the writing — oh, the writing is fine.",
      "time": "9:41 AM",
      "kind": "say"
    },
    {
      "who": "Ola",
      "avatar": "💁‍♂️",
      "color": "#d67aa8",
      "text": "Queue clear by ten. Nice.",
      "time": "9:58 AM",
      "kind": "say"
    }
  ],
  "finance": [
    {
      "who": "Hugo",
      "avatar": "🧑‍💼",
      "color": "#c9a227",
      "text": "September close. Somebody explain the milk line before lunch.",
      "time": "10:02 AM",
      "kind": "say"
    },
    {
      "who": "Gus",
      "avatar": "👨‍🏫",
      "color": "#d9b64a",
      "text": "Oat milk spend is up 40 percent, dairy flat. That is the whole variance, right there.",
      "time": "10:11 AM",
      "kind": "say"
    },
    {
      "who": "",
      "avatar": "",
      "color": "",
      "text": "Gus queried the ledger — found 58 records",
      "time": "10:12 AM",
      "kind": "sys"
    },
    {
      "who": "Fay",
      "avatar": "👩‍⚖️",
      "color": "#c9a227",
      "text": "Tied to till rows, not vibes. The close stands.",
      "time": "10:26 AM",
      "kind": "say"
    },
    {
      "who": "Fay",
      "avatar": "👩‍⚖️",
      "color": "#c9a227",
      "text": "Menu board gets a smaller oat pour from Monday. Nobody tell the regulars.",
      "time": "10:27 AM",
      "kind": "say"
    },
    {
      "who": "Gus",
      "avatar": "👨‍🏫",
      "color": "#d9b64a",
      "text": "The regulars will notice in eleven minutes.",
      "time": "10:28 AM",
      "kind": "say"
    }
  ],
  "research": [
    {
      "who": "Piet",
      "avatar": "🧑‍💼",
      "color": "#7f8cd6",
      "text": "Winter is coming and the menu is not ready. One drink, tested, no advent calendar.",
      "time": "11:00 AM",
      "kind": "say"
    },
    {
      "who": "Val",
      "avatar": "🕵️",
      "color": "#7f8cd6",
      "text": "Cardamom oat latte. Twelve regulars tasted, nine would order it again.",
      "time": "11:20 AM",
      "kind": "say"
    },
    {
      "who": "",
      "avatar": "",
      "color": "",
      "text": "Val saved “Winter drink trials” to files",
      "time": "11:25 AM",
      "kind": "sys"
    },
    {
      "who": "Val",
      "avatar": "🕵️",
      "color": "#7f8cd6",
      "text": "Two asked if it comes iced. It comes iced.",
      "time": "11:26 AM",
      "kind": "say"
    }
  ]
};
