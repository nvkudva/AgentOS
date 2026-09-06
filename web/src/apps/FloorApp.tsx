import { RoomWidget } from '../components/RoomWidget';
import type { Room, Agent } from '../lib/api';

/** The spatial overview, now one app on the desktop rather than the whole screen. */
export function FloorApp({ rooms, agents, onOpen }:
  { rooms: Room[]; agents: Agent[]; onOpen: (r: Room) => void }) {
  return (
    <div className="floor">
      <div className="grid" style={{ ['--cols' as any]: 4 }}>
        {rooms.map((r) => (
          <RoomWidget key={r.id} room={r} agents={agents.filter((a) => a.room_id === r.id)} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}
