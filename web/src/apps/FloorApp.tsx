import { RoomWidget } from '../components/RoomWidget';
import type { Room, Agent, Mandate, Task, Inbox } from '../lib/api';

/** Every room and its crew on one card grid — the thesis instrument, as an app. */
export function FloorApp({ rooms, agents, mandates = [], tasks = [], onOpen, inbox = [], view, onDecide, consoles = [] }: {
  rooms: Room[]; agents: Agent[]; mandates?: Mandate[]; tasks?: Task[]; onOpen: (r: Room) => void;
  inbox?: Inbox[]; view?: string; onDecide?: (it: Inbox, decision: 'approve' | 'reject') => void;
  consoles?: string[];
}) {
  return (
    <div className="floor">
      <div className="grid" style={{ ['--cols' as any]: 4 }}>
        {rooms.map((r) => (
          <RoomWidget key={r.id} room={r} agents={agents.filter((a) => a.room_id === r.id)}
                      mandates={mandates} tasks={tasks} onOpen={onOpen}
                      inbox={inbox} view={view} onDecide={onDecide}
                      consoleOpen={consoles.includes(r.id)} />
        ))}
      </div>
    </div>
  );
}
