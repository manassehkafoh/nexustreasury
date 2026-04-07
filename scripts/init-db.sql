-- NexusTreasury Database Initialisation
-- Creates schemas per bounded context with Row Level Security

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "timescaledb" CASCADE;
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create schemas (one per bounded context)
CREATE SCHEMA IF NOT EXISTS trading;
CREATE SCHEMA IF NOT EXISTS position;
CREATE SCHEMA IF NOT EXISTS risk;
CREATE SCHEMA IF NOT EXISTS alm;
CREATE SCHEMA IF NOT EXISTS backoffice;
CREATE SCHEMA IF NOT EXISTS accounting;
CREATE SCHEMA IF NOT EXISTS marketdata;
CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS audit;

-- Create keycloak DB
CREATE DATABASE keycloak;

-- Tenant isolation via RLS
-- Each service sets: SET app.current_tenant_id = '<tenantId>'
ALTER DATABASE nexustreasury SET row_security = on;

COMMENT ON DATABASE nexustreasury IS 'NexusTreasury - Cloud-Native Treasury Management Platform';
