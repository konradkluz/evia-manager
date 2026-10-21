-- Roles of the staging database (EVM-007 AC4; ADR-0003; architect 15; security-engineer B "Sekrety"). Run once by the
-- PostgreSQL image entrypoint when the data directory is initialised (installed only in an IaC session at
-- /etc/evia/runtime/postgres-init). Passwords are NOT here: the IaC session sets them from /etc/evia/secrets with
-- ALTER ROLE … PASSWORD (runbook docs/ops/runbooks/wdrozenie-staging.md) and writes the connection URLs of
-- database-url-migrator and database-url-app.
-- evia_migrator: runs the migrations (one-off `migrate` container) and owns the database objects; not a superuser.
-- evia_app: NOLOGIN group of the application (also created by migration 0002, which tolerates an existing role).
-- evia_api: the login of the API and the worker, a member of evia_app; never the owner of anything.
CREATE ROLE evia_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE evia_app NOLOGIN;
CREATE ROLE evia_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS IN ROLE evia_app;
ALTER DATABASE evia OWNER TO evia_migrator;
REVOKE ALL ON DATABASE evia FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE evia TO evia_app;
\connect evia
ALTER SCHEMA public OWNER TO evia_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO evia_app;
