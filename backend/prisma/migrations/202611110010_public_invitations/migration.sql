ALTER TABLE ticket_issue_receipts ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE students ADD CONSTRAINT students_id_event_identity UNIQUE(id,event_id);
CREATE TABLE public_invitation_links (
 id SERIAL PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id), student_id INTEGER NOT NULL,
 token_hash VARCHAR(64) NOT NULL UNIQUE, expires_at TIMESTAMP(6) NOT NULL,
 revoked_at TIMESTAMP(6), created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT public_invitation_student_event FOREIGN KEY(student_id,event_id) REFERENCES students(id,event_id)
);
CREATE INDEX public_invitation_links_event_id_student_id_idx ON public_invitation_links(event_id,student_id);
CREATE TABLE public_invitation_operations (
 id SERIAL PRIMARY KEY, link_id INTEGER NOT NULL REFERENCES public_invitation_links(id),
 request_key VARCHAR(80) NOT NULL,content_hash VARCHAR(64) NOT NULL,result JSONB NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT public_invitation_operations_link_id_request_key_key UNIQUE(link_id,request_key)
);
CREATE TRIGGER public_invitation_operations_immutable BEFORE UPDATE OR DELETE ON public_invitation_operations
 FOR EACH ROW EXECUTE FUNCTION aast_history_immutable();
