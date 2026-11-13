CREATE TABLE event_communications (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  actor_id INTEGER NOT NULL,
  kind VARCHAR(40) NOT NULL,
  request_key VARCHAR(80) NOT NULL,
  content_hash CHAR(64) NOT NULL,
  protected_result TEXT NOT NULL,
  recipient_count INTEGER NOT NULL CHECK (recipient_count >= 0),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, kind, request_key)
);
CREATE INDEX event_communications_event_id_created_at_idx ON event_communications(event_id, created_at);
CREATE FUNCTION protect_event_communications() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Communication history is immutable'; END; $$;
CREATE TRIGGER event_communications_immutable BEFORE UPDATE OR DELETE ON event_communications
FOR EACH ROW EXECUTE FUNCTION protect_event_communications();
