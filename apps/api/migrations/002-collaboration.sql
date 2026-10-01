CREATE TABLE plans (
 id TEXT PRIMARY KEY, lab_id TEXT NOT NULL REFERENCES labs(id), owner_id TEXT NOT NULL REFERENCES members(id),
 version INTEGER NOT NULL CHECK(version > 0), document TEXT NOT NULL CHECK(json_valid(document))
) STRICT;
CREATE TABLE plan_versions (
 plan_id TEXT NOT NULL REFERENCES plans(id), version INTEGER NOT NULL,
 document TEXT NOT NULL CHECK(json_valid(document)), PRIMARY KEY(plan_id,version)
) STRICT;
CREATE TABLE tasks (
 id TEXT PRIMARY KEY, lab_id TEXT NOT NULL REFERENCES labs(id), plan_id TEXT NOT NULL REFERENCES plans(id), item_id TEXT NOT NULL,
 initiator_id TEXT NOT NULL REFERENCES members(id), lead_id TEXT REFERENCES members(id), reviewer_id TEXT NOT NULL REFERENCES members(id),
 status TEXT NOT NULL CHECK(status IN ('unassigned','awaiting_acceptance','ready','in_progress','blocked','in_review','changes_requested','completed','cancelled')),
 claimable INTEGER NOT NULL CHECK(claimable IN (0,1)), version INTEGER NOT NULL CHECK(version>0),
 created_at TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)),
 summary_document TEXT NOT NULL CHECK(json_valid(summary_document)), UNIQUE(plan_id,item_id)
) STRICT;
CREATE INDEX tasks_lab_order ON tasks(lab_id,created_at DESC,id DESC);
CREATE TABLE task_access (
 task_id TEXT NOT NULL REFERENCES tasks(id), member_id TEXT NOT NULL REFERENCES members(id),
 access TEXT NOT NULL CHECK(access IN ('full','summary','revoked')), PRIMARY KEY(task_id,member_id)
) STRICT;
CREATE TABLE assignments (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), member_id TEXT NOT NULL REFERENCES members(id),
 kind TEXT NOT NULL CHECK(kind IN ('self','invitation','claim')), status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined','withdrawn','transferred','cancelled')),
 version INTEGER NOT NULL CHECK(version>0), document TEXT NOT NULL CHECK(json_valid(document)),
 offer_scope TEXT NOT NULL, offer_schedule TEXT NOT NULL CHECK(json_valid(offer_schedule))
) STRICT;
CREATE UNIQUE INDEX one_lead_commitment ON assignments(task_id) WHERE status='accepted';
CREATE UNIQUE INDEX one_pending_invitation ON assignments(task_id) WHERE status='pending';
CREATE INDEX assignments_member ON assignments(member_id,status,task_id);
CREATE TABLE deliverables (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), revision INTEGER NOT NULL CHECK(revision>0),
 version INTEGER NOT NULL CHECK(version>0), document TEXT NOT NULL CHECK(json_valid(document)), UNIQUE(task_id,revision)
) STRICT;
CREATE TABLE reviews (
 deliverable_id TEXT PRIMARY KEY REFERENCES deliverables(id), revision INTEGER NOT NULL,
 reviewer_id TEXT NOT NULL REFERENCES members(id), document TEXT NOT NULL CHECK(json_valid(document))
) STRICT;
CREATE TABLE task_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, task_id TEXT NOT NULL REFERENCES tasks(id),
 document TEXT NOT NULL CHECK(json_valid(document))
) STRICT;
CREATE TABLE runtime_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
INSERT INTO runtime_meta VALUES ('revision','0');
CREATE TABLE login_limits (key TEXT PRIMARY KEY,window_start INTEGER NOT NULL,attempts INTEGER NOT NULL) STRICT;
