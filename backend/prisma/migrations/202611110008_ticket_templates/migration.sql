CREATE TABLE ticket_templates (
 id SERIAL PRIMARY KEY,
 organization_id INTEGER NOT NULL REFERENCES organizations(id),
 name VARCHAR(100) NOT NULL,
 config JSONB NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP(6) NOT NULL,
 CONSTRAINT ticket_templates_organization_id_name_key UNIQUE(organization_id,name)
);
