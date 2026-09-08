import type { ToolSpec } from '../runtime/types.js';
import { sqlQuery, crmNote } from './sql.js';
import { artifactWrite, artifactRead } from './artifacts.js';
import { queueDraft, queuePublish } from './queue.js';
import { repoRead, repoPatch, repoTest } from './repo.js';
import { prOpen } from './github.js';
import { escalate, clarify } from './escalate.js';
import { ticketList, ticketReply } from './support.js';
import { assign, report } from './assign.js';

export const TOOLS: Record<string, ToolSpec> = Object.fromEntries(
  [sqlQuery, crmNote, artifactWrite, artifactRead, queueDraft, queuePublish,
   repoRead, repoPatch, repoTest, prOpen, escalate, clarify, ticketList, ticketReply,
   assign, report].map((t) => [t.name, t])
);
export const toolNames = Object.keys(TOOLS);
