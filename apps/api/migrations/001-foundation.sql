CREATE TABLE labs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL
) STRICT;
CREATE TABLE members (
  id TEXT PRIMARY KEY, lab_id TEXT NOT NULL REFERENCES labs(id),
  display_name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  is_synthetic INTEGER NOT NULL DEFAULT 0 CHECK(is_synthetic IN (0, 1))
) STRICT;
CREATE TABLE auth_accounts (
  member_id TEXT PRIMARY KEY REFERENCES members(id), username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0, 1))
) STRICT;
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
  csrf_hash TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
) STRICT;
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE idempotency_results (
  actor_id TEXT NOT NULL REFERENCES members(id), command TEXT NOT NULL, resource_id TEXT NOT NULL,
  key TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  http_status INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(actor_id, command, resource_id, key)
) STRICT;
CREATE TABLE outbox (
  id TEXT PRIMARY KEY, dedup_key TEXT NOT NULL UNIQUE, aggregate_id TEXT NOT NULL,
  aggregate_version INTEGER NOT NULL CHECK(aggregate_version > 0), kind TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','delivered','cancelled','uncertain')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  available_at TEXT NOT NULL, lease_until TEXT, lease_owner TEXT, created_at TEXT NOT NULL
) STRICT;
CREATE INDEX outbox_dispatch ON outbox(status, available_at);
CREATE TABLE health_probe (id TEXT PRIMARY KEY, checked_at TEXT NOT NULL) STRICT;
