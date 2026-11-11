CREATE TABLE ticket_dispatches (
 job_id INTEGER PRIMARY KEY REFERENCES background_jobs(id), ticket_id INTEGER NOT NULL REFERENCES tickets(id),
 event_id INTEGER NOT NULL REFERENCES events(id), token_hash VARCHAR(64) NOT NULL, recipient VARCHAR(254) NOT NULL,
 fingerprint VARCHAR(64) NOT NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT dispatch_ticket_event FOREIGN KEY(ticket_id,event_id) REFERENCES tickets(id,event_id)
);
CREATE INDEX ticket_dispatches_event_id_ticket_id_idx ON ticket_dispatches(event_id,ticket_id);
ALTER TABLE background_jobs ADD CONSTRAINT job_event_identity UNIQUE(id,event_id);
ALTER TABLE ticket_dispatches ADD CONSTRAINT dispatch_job_event FOREIGN KEY(job_id,event_id) REFERENCES background_jobs(id,event_id);
CREATE TABLE ticket_mail_operations (
 id SERIAL PRIMARY KEY,event_id INTEGER NOT NULL REFERENCES events(id),actor_id INTEGER NOT NULL REFERENCES account_identities(id),
 request_key VARCHAR(80) NOT NULL,content_hash VARCHAR(64) NOT NULL,result JSONB NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT ticket_mail_operations_event_id_request_key_key UNIQUE(event_id,request_key)
);
CREATE TABLE ticket_mail_notices (
 job_id INTEGER PRIMARY KEY REFERENCES background_jobs(id),event_id INTEGER NOT NULL REFERENCES events(id),
 message VARCHAR(200) NOT NULL,created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT notice_job_event FOREIGN KEY(job_id,event_id) REFERENCES background_jobs(id,event_id)
);
CREATE INDEX ticket_mail_notices_event_id_idx ON ticket_mail_notices(event_id);
CREATE TRIGGER ticket_dispatches_immutable BEFORE UPDATE OR DELETE ON ticket_dispatches FOR EACH ROW EXECUTE FUNCTION aast_history_immutable();
CREATE TRIGGER ticket_mail_operations_immutable BEFORE UPDATE OR DELETE ON ticket_mail_operations FOR EACH ROW EXECUTE FUNCTION aast_history_immutable();
CREATE TRIGGER ticket_mail_notices_immutable BEFORE UPDATE OR DELETE ON ticket_mail_notices FOR EACH ROW EXECUTE FUNCTION aast_history_immutable();
