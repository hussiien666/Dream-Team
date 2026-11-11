CREATE TABLE ticket_credentials (
 ticket_id INTEGER PRIMARY KEY REFERENCES tickets(id),
 token_hash VARCHAR(64) NOT NULL,
 protected_token TEXT NOT NULL,
 updated_at TIMESTAMP(6) NOT NULL
);
CREATE TABLE ticket_issue_receipts (
 id SERIAL PRIMARY KEY,
 event_id INTEGER NOT NULL REFERENCES events(id),
 actor_id INTEGER NOT NULL REFERENCES account_identities(id),
 request_key VARCHAR(80) NOT NULL,
 content_hash VARCHAR(64) NOT NULL,
 result JSONB NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT ticket_issue_receipts_event_id_request_key_key UNIQUE(event_id,request_key)
);
CREATE TRIGGER ticket_issue_receipts_immutable BEFORE UPDATE OR DELETE ON ticket_issue_receipts
 FOR EACH ROW EXECUTE FUNCTION aast_history_immutable();
