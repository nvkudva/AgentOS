import * as humanize from '../humanize';
import type * as Ctx from './context';
import type * as Query from './query';
import type * as Api from '../api';

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

export function countWord(n: number): string {
  return n >= 0 && n <= 10 ? WORDS[n] : String(n);
}

function firstSentence(text: string): string {
  const clean = (text ?? '').trim();
  if (!clean) return '';
  const idx = clean.search(/[.!?](\s|$)/);
  return idx >= 0 ? clean.slice(0, idx + 1) : clean;
}

export function sayRoom(f: Query.RoomFacts): string {
  const parts: string[] = [`${f.room.name}: ${f.progress.where}`];
  if (f.blocked.length) parts.push(`${countWord(f.blocked.length)} blocked`);
  if (f.waiting.length) parts.push(`${countWord(f.waiting.length)} waiting on you`);
  const head = parts.join(' ');
  const report = firstSentence(f.progress.report);
  const sentence = head.endsWith('.') ? head : `${head}.`;
  return report ? `${sentence} ${report}` : sentence;
}

export function sayList(kind: Ctx.IntentKind, items: Ctx.ListItem[], total: number): string {
  if (!items.length) return emptySay(kind);
  const shown = items.slice(0, 5);
  const labels = shown.map((i, ix) => `${ix + 1}. ${i.label}`).join('; ');
  const more = total > shown.length ? ` And ${countWord(total - shown.length)} more on screen.` : '';
  return `${countWord(total)} ${nounFor(kind, total)}: ${labels}.${more}`;
}

function nounFor(kind: Ctx.IntentKind, total: number): string {
  if (kind === 'status.blocked') return total === 1 ? 'blocked item' : 'blocked items';
  if (kind === 'status.needsme' || kind === 'approval.nav') return total === 1 ? 'item waiting on you' : 'items waiting on you';
  if (kind === 'status.finished') return total === 1 ? 'finished item' : 'finished items';
  if (kind === 'status.running') return total === 1 ? 'running item' : 'running items';
  if (kind === 'search') return total === 1 ? 'match' : 'matches';
  return total === 1 ? 'item' : 'items';
}

function emptySay(kind: Ctx.IntentKind): string {
  if (kind === 'status.blocked') return 'Nothing is blocked.';
  if (kind === 'status.needsme' || kind === 'approval.nav') return 'Nothing is waiting on you.';
  if (kind === 'status.finished') return 'Nothing has finished yet.';
  if (kind === 'status.running') return 'Nothing is running right now.';
  if (kind === 'search') return 'No matches.';
  return 'Nothing to show.';
}

export function sayNeedsMe(count: number, top: Api.Inbox | null): string {
  if (!count || !top) return 'Nothing is waiting on you.';
  return `${countWord(count)} waiting on you. The biggest is ${top.agent_name} in ${top.room_name}, about ${humanize.hours(top.est_cost_cents)}.`;
}

export function sayAgent(agent: Api.Agent, room: Api.Room | null): string {
  const where = room ? ` in ${room.name}` : '';
  return `${agent.name}${where}: ${humanize.friendlyActivity(agent.activity, agent.state)}.`;
}

export function sayBudget(room: Api.Room): string {
  const left = Math.max(0, room.budget_cents - room.spent_cents);
  return `${room.name} has ${humanize.hours(left)} of budget left.`;
}

export function sayCrew(room: Api.Room, crew: Api.Agent[]): string {
  if (!crew.length) return `Nobody is in ${room.name}.`;
  const mgr = crew.find((a) => a.tier === 'manager');
  const names = crew.map((a) => a.name).join(' and ');
  return mgr ? `${mgr.name} runs ${room.name}. Crew: ${names}.` : `${room.name} crew: ${names}.`;
}
