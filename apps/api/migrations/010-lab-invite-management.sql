ALTER TABLE registration_invites ADD COLUMN bootstrap_manager INTEGER NOT NULL DEFAULT 0 CHECK(bootstrap_manager IN (0,1));
ALTER TABLE registration_invites ADD COLUMN created_by TEXT REFERENCES members(id);
ALTER TABLE registration_invites ADD COLUMN request_key TEXT;
ALTER TABLE registration_invites ADD COLUMN request_hash TEXT;
ALTER TABLE registration_invites ADD COLUMN revoked_by TEXT REFERENCES members(id);
CREATE UNIQUE INDEX registration_invites_request_key ON registration_invites(request_key) WHERE request_key IS NOT NULL;
CREATE TABLE lab_managers (
 lab_id TEXT PRIMARY KEY REFERENCES labs(id),
 member_id TEXT NOT NULL UNIQUE REFERENCES members(id),
 granted_at TEXT NOT NULL,
 bootstrap_invite_id TEXT REFERENCES registration_invites(id)
) STRICT;
