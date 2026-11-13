CREATE TABLE firebase_identities (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  uid VARCHAR(128) NOT NULL UNIQUE,
  email VARCHAR(254) NOT NULL,
  linked_at TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE security_sessions ADD COLUMN firebase_uid VARCHAR(128), ADD COLUMN firebase_auth_time INTEGER;
ALTER TABLE security_sessions ADD CONSTRAINT security_sessions_firebase_binding
  CHECK ((firebase_uid IS NULL) = (firebase_auth_time IS NULL));
