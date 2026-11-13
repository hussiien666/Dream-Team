-- Event-scoped keyset reads: keep page depth independent of skipped row count.
CREATE INDEX attendees_event_id_id_idx ON attendees(event_id,id);
CREATE INDEX tickets_event_id_id_idx ON tickets(event_id,id);
CREATE INDEX students_event_id_id_idx ON students(event_id,id);
CREATE INDEX guest_invitations_event_id_id_idx ON guest_invitations(event_id,id);
