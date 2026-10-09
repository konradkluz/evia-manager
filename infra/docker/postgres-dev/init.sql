-- Marker of the local development database (EVM-077 AC4). Mounted read-only into /docker-entrypoint-initdb.d by
-- compose.dev.yaml and run once by the image entrypoint, as the owner of the new database `evia_dev`. It is stored in the
-- database itself (pg_db_role_setting), so a session cannot forge it with `options=-c …` or PGOPTIONS; the guard of the
-- development tools refuses to write to any database that does not have it. Nothing else lives here.
ALTER DATABASE evia_dev SET evia.env = 'local-dev';
