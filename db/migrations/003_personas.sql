-- Agents are characters, not rows: a persona, a colour and a face.
ALTER TABLE agent ADD COLUMN IF NOT EXISTS persona text NOT NULL DEFAULT '';
ALTER TABLE agent ADD COLUMN IF NOT EXISTS color   text NOT NULL DEFAULT '#7c8798';
ALTER TABLE agent ADD COLUMN IF NOT EXISTS avatar  text NOT NULL DEFAULT '●';
ALTER TABLE room  ADD COLUMN IF NOT EXISTS color   text NOT NULL DEFAULT '#7c8798';
ALTER TABLE room  ADD COLUMN IF NOT EXISTS icon    text NOT NULL DEFAULT '▣';
