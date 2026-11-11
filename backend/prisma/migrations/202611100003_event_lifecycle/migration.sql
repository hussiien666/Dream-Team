-- Additive values retain every legacy status and QR identity.
ALTER TYPE "EventStatus" ADD VALUE 'Upcoming';
ALTER TYPE "EventStatus" ADD VALUE 'Active';
ALTER TYPE "TicketStatus" ADD VALUE 'Cancelled';
