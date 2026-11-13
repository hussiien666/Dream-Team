-- Additive, local preparation only. Do not apply to hosted databases before cutover approval.
CREATE TABLE mail_send_attempts (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES background_jobs(id) ON DELETE RESTRICT,
  mailbox_hash CHAR(64) NOT NULL,
  reserved_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX mail_send_attempts_mailbox_hash_reserved_at_idx ON mail_send_attempts(mailbox_hash, reserved_at);
