-- Decouple present registration category from immutable used-ticket categories.
ALTER TABLE attendees ADD CONSTRAINT attendee_event_identity UNIQUE(id,event_id);
ALTER TABLE tickets DROP CONSTRAINT ticket_attendee_event;
ALTER TABLE tickets ADD CONSTRAINT ticket_attendee_event FOREIGN KEY(attendee_id,event_id) REFERENCES attendees(id,event_id);
ALTER TABLE tickets ADD CONSTRAINT ticket_category_event FOREIGN KEY(category_id,event_id) REFERENCES ticket_categories(id,event_id);
CREATE TABLE students (
 id SERIAL PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id), student_id VARCHAR(100) NOT NULL,
 full_name VARCHAR(200) NOT NULL, email VARCHAR(254) NOT NULL, phone VARCHAR(40) NOT NULL DEFAULT '',
 active BOOLEAN NOT NULL DEFAULT true, guest_limit INTEGER CHECK(guest_limit>=0), custom_values JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(6) NOT NULL,
 CONSTRAINT students_event_id_student_id_key UNIQUE(event_id,student_id), CONSTRAINT student_event_identity UNIQUE(id,event_id)
);
CREATE INDEX students_event_id_full_name_idx ON students(event_id,full_name);
CREATE TABLE guest_invitations (
 id SERIAL PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id), student_id INTEGER NOT NULL REFERENCES students(id),
 attendee_id INTEGER NOT NULL UNIQUE REFERENCES attendees(id), email VARCHAR(254), match_key VARCHAR(64) NOT NULL,
 invitation_group VARCHAR(200) NOT NULL DEFAULT '', active BOOLEAN NOT NULL DEFAULT true, custom_values JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(6) NOT NULL,
 CONSTRAINT guest_invitations_student_id_match_key_key UNIQUE(student_id,match_key),
 CONSTRAINT guest_student_event FOREIGN KEY(student_id,event_id) REFERENCES students(id,event_id),
 CONSTRAINT guest_attendee_event FOREIGN KEY(attendee_id,event_id) REFERENCES attendees(id,event_id)
);
CREATE INDEX guest_invitations_event_id_idx ON guest_invitations(event_id);
CREATE TABLE registration_fields (
 id SERIAL PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id), target VARCHAR(10) NOT NULL CHECK(target IN ('student','guest')),
 key VARCHAR(60) NOT NULL, label VARCHAR(100) NOT NULL, type VARCHAR(12) NOT NULL CHECK(type IN ('text','number','email','phone','date','dropdown','checkbox')),
 required BOOLEAN NOT NULL DEFAULT false, active BOOLEAN NOT NULL DEFAULT true, options JSONB NOT NULL DEFAULT '[]',
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(6) NOT NULL,
 CONSTRAINT registration_fields_event_id_target_key_key UNIQUE(event_id,target,key)
);
CREATE TABLE registration_imports (
 id SERIAL PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id), actor_id INTEGER NOT NULL REFERENCES users(id),
 request_key VARCHAR(80) NOT NULL, content_hash VARCHAR(64) NOT NULL, result JSONB NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT registration_imports_event_id_request_key_key UNIQUE(event_id,request_key)
);
CREATE TRIGGER registration_imports_immutable BEFORE UPDATE OR DELETE ON registration_imports FOR EACH ROW EXECUTE FUNCTION aast_history_immutable();
