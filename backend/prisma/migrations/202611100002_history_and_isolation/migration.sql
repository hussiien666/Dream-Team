-- Preserve legacy database invariants which Prisma cannot express as checks.
ALTER TABLE events ADD CONSTRAINT ck_event_capacity CHECK (capacity > 0 AND max_tickets > 0 AND max_tickets <= capacity);
ALTER TABLE events ADD CONSTRAINT ck_event_times CHECK (ends_at > starts_at);
ALTER TABLE ticket_categories ADD CONSTRAINT ck_category_limits CHECK (allocation > 0 AND max_per_attendee > 0 AND price >= 0);
ALTER TABLE security_profiles ADD CONSTRAINT ck_factor_method CHECK (factor_method IN ('','totp','email'));

ALTER TABLE ticket_categories ADD CONSTRAINT category_event_identity UNIQUE(id,event_id);
ALTER TABLE entrances ADD CONSTRAINT entrance_event_identity UNIQUE(id,event_id);
ALTER TABLE attendees ADD CONSTRAINT attendee_ticket_identity UNIQUE(id,event_id,category_id);
ALTER TABLE tickets ADD CONSTRAINT ticket_event_identity UNIQUE(id,event_id);
ALTER TABLE access_codes ADD CONSTRAINT code_event_identity UNIQUE(id,event_id);

ALTER TABLE event_assignments ADD CONSTRAINT assignment_user_organization FOREIGN KEY(user_id,organization_id) REFERENCES organization_users(user_id,organization_id) ON DELETE CASCADE;
ALTER TABLE event_assignments ADD CONSTRAINT assignment_event_organization FOREIGN KEY(event_id,organization_id) REFERENCES organization_events(event_id,organization_id) ON DELETE CASCADE;
ALTER TABLE attendees ADD CONSTRAINT attendee_category_event FOREIGN KEY(category_id,event_id) REFERENCES ticket_categories(id,event_id);
ALTER TABLE entrance_category_permissions ADD CONSTRAINT permission_entrance_event FOREIGN KEY(entrance_id,event_id) REFERENCES entrances(id,event_id) ON DELETE CASCADE;
ALTER TABLE entrance_category_permissions ADD CONSTRAINT permission_category_event FOREIGN KEY(category_id,event_id) REFERENCES ticket_categories(id,event_id) ON DELETE CASCADE;
ALTER TABLE tickets ADD CONSTRAINT ticket_attendee_event FOREIGN KEY(attendee_id,event_id,category_id) REFERENCES attendees(id,event_id,category_id);
ALTER TABLE check_ins ADD CONSTRAINT checkin_ticket_event FOREIGN KEY(ticket_id,event_id) REFERENCES tickets(id,event_id);
ALTER TABLE check_ins ADD CONSTRAINT checkin_entrance_event FOREIGN KEY(entrance_id,event_id) REFERENCES entrances(id,event_id);
ALTER TABLE email_deliveries ADD CONSTRAINT email_ticket_event FOREIGN KEY(ticket_id,event_id) REFERENCES tickets(id,event_id);
ALTER TABLE code_entrances ADD CONSTRAINT code_entrance_event FOREIGN KEY(entrance_id,event_id) REFERENCES entrances(id,event_id);
ALTER TABLE code_entrances ADD CONSTRAINT code_configuration_event FOREIGN KEY(code_id,event_id) REFERENCES access_codes(id,event_id);
ALTER TABLE scanner_sessions ADD CONSTRAINT session_code_event FOREIGN KEY(code_id,event_id) REFERENCES access_codes(id,event_id);
ALTER TABLE scanner_sessions ADD CONSTRAINT session_entrance_event FOREIGN KEY(entrance_id,event_id) REFERENCES entrances(id,event_id);

CREATE FUNCTION aast_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'History is immutable'; END;
$$;
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION aast_history_immutable();
CREATE TRIGGER check_ins_immutable BEFORE UPDATE OR DELETE ON check_ins FOR EACH ROW EXECUTE FUNCTION aast_history_immutable();
