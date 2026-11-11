CREATE TABLE mail_deliveries (
  job_id INTEGER PRIMARY KEY REFERENCES background_jobs(id) ON DELETE RESTRICT,
  provider_message_id VARCHAR(120) UNIQUE,
  status VARCHAR(24) NOT NULL DEFAULT 'Pending',
  first_attempt_at TIMESTAMP(6), last_event_at TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(6) NOT NULL,
  CONSTRAINT ck_mail_delivery_status CHECK(status IN ('Pending','Sent','Delivered','Delayed','Bounced','Complained','Failed','Unknown'))
);
CREATE TABLE mail_webhooks (
  id VARCHAR(160) PRIMARY KEY,
  provider_message_id VARCHAR(120) NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  occurred_at TIMESTAMP(6) NOT NULL,
  received_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX mail_webhooks_message_time ON mail_webhooks(provider_message_id,occurred_at);
CREATE TRIGGER mail_webhooks_immutable BEFORE UPDATE OR DELETE ON mail_webhooks FOR EACH ROW EXECUTE FUNCTION aast_history_immutable();
