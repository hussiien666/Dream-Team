-- Add ownership evidence without rewriting immutable audit rows. Historical global
-- actions or deleted events with no provable owner deliberately remain unscoped.
CREATE TABLE audit_organization_scopes (
  audit_log_id INTEGER PRIMARY KEY REFERENCES audit_logs(id) ON DELETE RESTRICT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT
);
CREATE INDEX audit_organization_scopes_organization_id_audit_log_id_idx
  ON audit_organization_scopes(organization_id, audit_log_id);
INSERT INTO audit_organization_scopes(audit_log_id, organization_id)
  SELECT a.id, e.organization_id FROM audit_logs a
  JOIN organization_events e ON e.event_id=a.event_id;

CREATE FUNCTION record_audit_organization() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public AS $$
DECLARE owner_id INTEGER;
BEGIN
  IF NEW.event_id IS NOT NULL THEN
    SELECT organization_id INTO owner_id FROM public.organization_events WHERE event_id=NEW.event_id;
  ELSE
    SELECT organization_id INTO owner_id FROM public.organization_users WHERE user_id=NEW.actor_id;
  END IF;
  IF owner_id IS NOT NULL THEN
    INSERT INTO public.audit_organization_scopes(audit_log_id,organization_id) VALUES(NEW.id,owner_id);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER audit_organization_recorded AFTER INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION record_audit_organization();
CREATE FUNCTION protect_audit_organization_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit organization ownership is immutable'; END; $$;
CREATE TRIGGER audit_organization_scope_immutable BEFORE UPDATE OR DELETE ON audit_organization_scopes
  FOR EACH ROW EXECUTE FUNCTION protect_audit_organization_scope();
