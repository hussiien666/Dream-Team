CREATE TYPE "TicketTransferStatus" AS ENUM ('Pending', 'Approved', 'Rejected', 'Cancelled');

CREATE TABLE public_ticket_links (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP(6) NOT NULL,
  revoked_at TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX public_ticket_links_event_id_ticket_id_idx ON public_ticket_links(event_id, ticket_id);

CREATE TABLE public_ticket_operations (
  id SERIAL PRIMARY KEY,
  link_id INTEGER NOT NULL REFERENCES public_ticket_links(id),
  request_key VARCHAR(80) NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT public_ticket_operations_link_id_request_key_key UNIQUE(link_id, request_key)
);
CREATE TRIGGER public_ticket_operations_immutable BEFORE UPDATE OR DELETE ON public_ticket_operations
  FOR EACH ROW EXECUTE FUNCTION aast_history_immutable();

CREATE TABLE ticket_transfers (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  from_attendee_id INTEGER NOT NULL REFERENCES attendees(id),
  to_attendee_id INTEGER REFERENCES attendees(id),
  new_ticket_id INTEGER REFERENCES tickets(id),
  initiated_by VARCHAR(20) NOT NULL,
  requester_actor_id INTEGER REFERENCES account_identities(id),
  recipient_name VARCHAR(200) NOT NULL,
  recipient_email VARCHAR(254),
  recipient_phone VARCHAR(40) NOT NULL DEFAULT '',
  custom_values JSONB NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL DEFAULT '',
  status "TicketTransferStatus" NOT NULL DEFAULT 'Pending',
  resolved_at TIMESTAMP(6),
  resolved_by INTEGER REFERENCES account_identities(id),
  rejection_reason TEXT NOT NULL DEFAULT '',
  deadline TIMESTAMP(6),
  super_admin_override BOOLEAN NOT NULL DEFAULT false,
  override_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ticket_transfers_event_id_status_idx ON ticket_transfers(event_id, status);
CREATE INDEX ticket_transfers_ticket_id_idx ON ticket_transfers(ticket_id);
