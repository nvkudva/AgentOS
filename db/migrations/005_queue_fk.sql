-- Deleting a room should take its drafts with it. Without this, a throwaway room from a
-- test leaves rows in the real content queue.
DELETE FROM content_queue WHERE room_id NOT IN (SELECT id FROM room);
ALTER TABLE content_queue DROP CONSTRAINT IF EXISTS content_queue_room_fk;
ALTER TABLE content_queue
  ADD CONSTRAINT content_queue_room_fk FOREIGN KEY (room_id) REFERENCES room(id) ON DELETE CASCADE;
