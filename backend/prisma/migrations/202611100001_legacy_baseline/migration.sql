-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'staff');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('super_admin', 'event_manager', 'ticket_manager', 'checkin_supervisor', 'scanner');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('Draft', 'Published', 'Ongoing', 'Completed', 'Cancelled');

-- CreateEnum
CREATE TYPE "AttendeeStatus" AS ENUM ('Registered', 'Cancelled');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('Active', 'Used', 'Revoked', 'Expired');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('Pending', 'Sent', 'Failed', 'Unknown');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('Pending', 'Running', 'Sent', 'Failed', 'Unknown');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(80) NOT NULL,
    "display_name" VARCHAR(160) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'admin',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "token_hash" VARCHAR(64) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_users" (
    "user_id" INTEGER NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "role" "OrgRole" NOT NULL,

    CONSTRAINT "organization_users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "subtitle" VARCHAR(200) NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "organization" VARCHAR(200) NOT NULL DEFAULT 'AAST',
    "event_type" VARCHAR(100) NOT NULL DEFAULT 'University event',
    "status" "EventStatus" NOT NULL DEFAULT 'Draft',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "event_date" DATE NOT NULL,
    "starts_at" TIMESTAMP(6) NOT NULL,
    "ends_at" TIMESTAMP(6) NOT NULL,
    "timezone" VARCHAR(80) NOT NULL DEFAULT 'Africa/Cairo',
    "distribution_start" TIMESTAMP(6),
    "distribution_end" TIMESTAMP(6),
    "registration_deadline" TIMESTAMP(6),
    "country" VARCHAR(100) NOT NULL DEFAULT 'Egypt',
    "city" VARCHAR(100) NOT NULL DEFAULT '',
    "venue" VARCHAR(200) NOT NULL,
    "building" VARCHAR(200) NOT NULL DEFAULT '',
    "address" VARCHAR(500) NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL DEFAULT '',
    "capacity" INTEGER NOT NULL,
    "max_tickets" INTEGER NOT NULL,
    "logo" BYTEA,
    "banner" BYTEA,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_events" (
    "event_id" INTEGER NOT NULL,
    "organization_id" INTEGER NOT NULL,

    CONSTRAINT "organization_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "event_assignments" (
    "user_id" INTEGER NOT NULL,
    "event_id" INTEGER NOT NULL,
    "organization_id" INTEGER NOT NULL,

    CONSTRAINT "event_assignments_pkey" PRIMARY KEY ("user_id","event_id")
);

-- CreateTable
CREATE TABLE "ticket_categories" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "color" VARCHAR(7) NOT NULL DEFAULT '#142D4E',
    "allocation" INTEGER NOT NULL,
    "max_per_attendee" INTEGER NOT NULL DEFAULT 1,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "ticket_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entrances" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "location" VARCHAR(200) NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "entrances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entrance_category_permissions" (
    "entrance_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "event_id" INTEGER NOT NULL,

    CONSTRAINT "entrance_category_permissions_pkey" PRIMARY KEY ("entrance_id","category_id")
);

-- CreateTable
CREATE TABLE "attendees" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(40) NOT NULL DEFAULT '',
    "identity_number" VARCHAR(100),
    "organization" VARCHAR(200) NOT NULL DEFAULT '',
    "status" "AttendeeStatus" NOT NULL DEFAULT 'Registered',
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" SERIAL NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "event_id" INTEGER NOT NULL,
    "attendee_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'Active',
    "expires_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_ins" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "entrance_id" INTEGER NOT NULL,
    "staff_id" INTEGER NOT NULL,
    "checked_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "actor_id" INTEGER,
    "event_id" INTEGER,
    "action" VARCHAR(100) NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_settings" (
    "event_id" INTEGER NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "event_settings_pkey" PRIMARY KEY ("event_id","key")
);

-- CreateTable
CREATE TABLE "email_deliveries" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "recipient" VARCHAR(254) NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'Pending',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "message_id" VARCHAR(255) NOT NULL,
    "sent_at" TIMESTAMP(6),
    "last_error" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_profiles" (
    "user_id" INTEGER NOT NULL,
    "email" VARCHAR(254),
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "factor_method" VARCHAR(12) NOT NULL DEFAULT '',
    "totp_secret" TEXT NOT NULL DEFAULT '',
    "totp_counter" INTEGER NOT NULL DEFAULT -1,
    "force_password" BOOLEAN NOT NULL DEFAULT false,
    "photo" BYTEA,

    CONSTRAINT "security_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "security_sessions" (
    "token_hash" VARCHAR(64) NOT NULL,
    "last_seen" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "enrollment_secret" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "security_sessions_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "recovery_codes" (
    "token_hash" VARCHAR(64) NOT NULL,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "action_tokens" (
    "token_hash" VARCHAR(64) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "purpose" VARCHAR(100) NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '',
    "expires_at" TIMESTAMP(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "action_tokens_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "permission_overrides" (
    "user_id" INTEGER NOT NULL,
    "permission" VARCHAR(60) NOT NULL,
    "allowed" BOOLEAN NOT NULL,

    CONSTRAINT "permission_overrides_pkey" PRIMARY KEY ("user_id","permission")
);

-- CreateTable
CREATE TABLE "access_codes" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "access_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_entrances" (
    "code_id" INTEGER NOT NULL,
    "entrance_id" INTEGER NOT NULL,
    "event_id" INTEGER NOT NULL,

    CONSTRAINT "code_entrances_pkey" PRIMARY KEY ("code_id","entrance_id")
);

-- CreateTable
CREATE TABLE "code_staff" (
    "code_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "code_staff_pkey" PRIMARY KEY ("code_id","user_id")
);

-- CreateTable
CREATE TABLE "scanner_sessions" (
    "user_id" INTEGER NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "event_id" INTEGER NOT NULL,
    "code_id" INTEGER NOT NULL,
    "entrance_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scanner_sessions_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "scanner_preferences" (
    "user_id" INTEGER NOT NULL,
    "success_sound" BOOLEAN NOT NULL DEFAULT true,
    "rejection_sound" BOOLEAN NOT NULL DEFAULT true,
    "success_vibration" BOOLEAN NOT NULL DEFAULT true,
    "rejection_vibration" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "scanner_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "scan_attempts" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "session_hash" VARCHAR(64) NOT NULL,
    "ticket_number" VARCHAR(40) NOT NULL DEFAULT '',
    "guest_name" VARCHAR(200) NOT NULL DEFAULT '',
    "accepted" BOOLEAN NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "background_jobs" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "event_id" INTEGER,
    "kind" VARCHAR(40) NOT NULL,
    "payload" TEXT NOT NULL,
    "dedupe_key" VARCHAR(255) NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'Pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMP(6),
    "lease_token" VARCHAR(64) NOT NULL DEFAULT '',
    "last_error" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "organization_users_organization_id_idx" ON "organization_users"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_users_user_id_organization_id_key" ON "organization_users"("user_id", "organization_id");

-- CreateIndex
CREATE INDEX "organization_events_organization_id_idx" ON "organization_events"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_events_event_id_organization_id_key" ON "organization_events"("event_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_categories_event_id_code_key" ON "ticket_categories"("event_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_categories_event_id_name_key" ON "ticket_categories"("event_id", "name");

-- CreateIndex
CREATE INDEX "entrances_event_id_idx" ON "entrances"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "entrances_event_id_code_key" ON "entrances"("event_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "entrances_event_id_name_key" ON "entrances"("event_id", "name");

-- CreateIndex
CREATE INDEX "attendees_event_id_idx" ON "attendees"("event_id");

-- CreateIndex
CREATE INDEX "attendees_event_id_full_name_idx" ON "attendees"("event_id", "full_name");

-- CreateIndex
CREATE UNIQUE INDEX "attendees_event_id_email_key" ON "attendees"("event_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "attendees_event_id_identity_number_key" ON "attendees"("event_id", "identity_number");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_number_key" ON "tickets"("number");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_token_hash_key" ON "tickets"("token_hash");

-- CreateIndex
CREATE INDEX "tickets_event_id_idx" ON "tickets"("event_id");

-- CreateIndex
CREATE INDEX "tickets_status_idx" ON "tickets"("status");

-- CreateIndex
CREATE UNIQUE INDEX "check_ins_ticket_id_key" ON "check_ins"("ticket_id");

-- CreateIndex
CREATE INDEX "check_ins_event_id_idx" ON "check_ins"("event_id");

-- CreateIndex
CREATE INDEX "check_ins_checked_at_idx" ON "check_ins"("checked_at");

-- CreateIndex
CREATE INDEX "audit_logs_event_id_idx" ON "audit_logs"("event_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "email_deliveries_event_id_idx" ON "email_deliveries"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_deliveries_ticket_id_token_hash_recipient_key" ON "email_deliveries"("ticket_id", "token_hash", "recipient");

-- CreateIndex
CREATE UNIQUE INDEX "security_profiles_email_key" ON "security_profiles"("email");

-- CreateIndex
CREATE INDEX "recovery_codes_user_id_idx" ON "recovery_codes"("user_id");

-- CreateIndex
CREATE INDEX "action_tokens_user_id_idx" ON "action_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "access_codes_code_hash_key" ON "access_codes"("code_hash");

-- CreateIndex
CREATE INDEX "access_codes_event_id_idx" ON "access_codes"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "scanner_sessions_token_hash_key" ON "scanner_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "scan_attempts_event_id_idx" ON "scan_attempts"("event_id");

-- CreateIndex
CREATE INDEX "scan_attempts_user_id_idx" ON "scan_attempts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "background_jobs_dedupe_key_key" ON "background_jobs"("dedupe_key");

-- CreateIndex
CREATE INDEX "background_jobs_organization_id_idx" ON "background_jobs"("organization_id");

-- CreateIndex
CREATE INDEX "background_jobs_event_id_idx" ON "background_jobs"("event_id");

-- CreateIndex
CREATE INDEX "background_jobs_status_available_at_idx" ON "background_jobs"("status", "available_at");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_users" ADD CONSTRAINT "organization_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_users" ADD CONSTRAINT "organization_users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_events" ADD CONSTRAINT "organization_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_events" ADD CONSTRAINT "organization_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_assignments" ADD CONSTRAINT "event_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_assignments" ADD CONSTRAINT "event_assignments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_assignments" ADD CONSTRAINT "event_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_categories" ADD CONSTRAINT "ticket_categories_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrances" ADD CONSTRAINT "entrances_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrance_category_permissions" ADD CONSTRAINT "entrance_category_permissions_entrance_id_fkey" FOREIGN KEY ("entrance_id") REFERENCES "entrances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrance_category_permissions" ADD CONSTRAINT "entrance_category_permissions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "ticket_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendees" ADD CONSTRAINT "attendees_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendees" ADD CONSTRAINT "attendees_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "ticket_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "attendees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "ticket_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_entrance_id_fkey" FOREIGN KEY ("entrance_id") REFERENCES "entrances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_settings" ADD CONSTRAINT "event_settings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_profiles" ADD CONSTRAINT "security_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_sessions" ADD CONSTRAINT "security_sessions_token_hash_fkey" FOREIGN KEY ("token_hash") REFERENCES "auth_sessions"("token_hash") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_tokens" ADD CONSTRAINT "action_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_entrances" ADD CONSTRAINT "code_entrances_code_id_fkey" FOREIGN KEY ("code_id") REFERENCES "access_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_entrances" ADD CONSTRAINT "code_entrances_entrance_id_fkey" FOREIGN KEY ("entrance_id") REFERENCES "entrances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_staff" ADD CONSTRAINT "code_staff_code_id_fkey" FOREIGN KEY ("code_id") REFERENCES "access_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_staff" ADD CONSTRAINT "code_staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scanner_sessions" ADD CONSTRAINT "scanner_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scanner_sessions" ADD CONSTRAINT "scanner_sessions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scanner_sessions" ADD CONSTRAINT "scanner_sessions_code_id_fkey" FOREIGN KEY ("code_id") REFERENCES "access_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scanner_sessions" ADD CONSTRAINT "scanner_sessions_entrance_id_fkey" FOREIGN KEY ("entrance_id") REFERENCES "entrances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scanner_preferences" ADD CONSTRAINT "scanner_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_attempts" ADD CONSTRAINT "scan_attempts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_attempts" ADD CONSTRAINT "scan_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
