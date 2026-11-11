-- Keep immutable evidence identifiers while allowing removal of actual login accounts.
CREATE TABLE account_identities (
 id INTEGER PRIMARY KEY, username VARCHAR(80) NOT NULL, display_name VARCHAR(160) NOT NULL,
 deleted_at TIMESTAMP(6), created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO account_identities(id,username,display_name,created_at) SELECT id,username,display_name,created_at FROM users;
CREATE FUNCTION account_identity_created() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO account_identities(id,username,display_name,created_at) VALUES(NEW.id,NEW.username,NEW.display_name,NEW.created_at);
 RETURN NEW;
END; $$;
CREATE TRIGGER account_identity_created BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION account_identity_created();
CREATE FUNCTION account_identity_renamed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE account_identities SET username=NEW.username,display_name=NEW.display_name WHERE id=NEW.id AND deleted_at IS NULL;
 RETURN NEW;
END; $$;
CREATE TRIGGER account_identity_renamed AFTER UPDATE OF username,display_name ON users FOR EACH ROW EXECUTE FUNCTION account_identity_renamed();
CREATE FUNCTION account_identity_retired() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE account_identities SET username='deleted_account_'||OLD.id,display_name='Deleted account #'||OLD.id,deleted_at=CURRENT_TIMESTAMP WHERE id=OLD.id AND deleted_at IS NULL;
 RETURN OLD;
END; $$;
CREATE TRIGGER account_identity_retired BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION account_identity_retired();
CREATE FUNCTION protect_retired_account_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Historical identity is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER protect_account_identity BEFORE UPDATE OR DELETE ON account_identities FOR EACH ROW EXECUTE FUNCTION protect_retired_account_identity();
ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_actor_id_fkey;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY(actor_id) REFERENCES account_identities(id) ON DELETE RESTRICT;
ALTER TABLE check_ins DROP CONSTRAINT check_ins_staff_id_fkey;
ALTER TABLE check_ins ADD CONSTRAINT check_ins_staff_id_fkey FOREIGN KEY(staff_id) REFERENCES account_identities(id) ON DELETE RESTRICT;
ALTER TABLE scan_attempts DROP CONSTRAINT scan_attempts_user_id_fkey;
ALTER TABLE scan_attempts ADD CONSTRAINT scan_attempts_user_id_fkey FOREIGN KEY(user_id) REFERENCES account_identities(id) ON DELETE RESTRICT;
ALTER TABLE registration_imports DROP CONSTRAINT registration_imports_actor_id_fkey;
ALTER TABLE registration_imports ADD CONSTRAINT registration_imports_actor_id_fkey FOREIGN KEY(actor_id) REFERENCES account_identities(id) ON DELETE RESTRICT;
