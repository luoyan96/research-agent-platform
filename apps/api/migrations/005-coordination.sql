CREATE TABLE task_versions(task_id TEXT NOT NULL REFERENCES tasks(id),version INTEGER NOT NULL,document TEXT NOT NULL CHECK(json_valid(document)),PRIMARY KEY(task_id,version)) STRICT;
INSERT INTO task_versions SELECT id,version,document FROM tasks;
CREATE TABLE assignment_versions(assignment_id TEXT NOT NULL REFERENCES assignments(id),version INTEGER NOT NULL,document TEXT NOT NULL CHECK(json_valid(document)),PRIMARY KEY(assignment_id,version)) STRICT;
INSERT INTO assignment_versions SELECT id,version,document FROM assignments;
CREATE TABLE task_dependencies(task_id TEXT NOT NULL REFERENCES tasks(id),upstream_id TEXT NOT NULL REFERENCES tasks(id),required_revision INTEGER,PRIMARY KEY(task_id,upstream_id),CHECK(task_id!=upstream_id)) STRICT;
INSERT INTO task_dependencies SELECT t.id,json_extract(d.value,'$.taskId'),json_extract(d.value,'$.requiredRevision') FROM tasks t,json_each(t.document,'$.dependencies') d;
CREATE INDEX dependency_upstream ON task_dependencies(upstream_id,task_id);
CREATE TABLE dependency_bindings(task_id TEXT NOT NULL REFERENCES tasks(id),upstream_id TEXT NOT NULL REFERENCES tasks(id),revision INTEGER NOT NULL,PRIMARY KEY(task_id,upstream_id)) STRICT;
CREATE TABLE dependency_impacts(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),upstream_id TEXT NOT NULL REFERENCES tasks(id),acknowledged INTEGER NOT NULL DEFAULT 0,document TEXT NOT NULL CHECK(json_valid(document))) STRICT;
CREATE INDEX unresolved_impacts ON dependency_impacts(task_id,acknowledged);
CREATE TABLE change_proposals(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),status TEXT NOT NULL,version INTEGER NOT NULL,document TEXT NOT NULL CHECK(json_valid(document))) STRICT;
CREATE UNIQUE INDEX one_pending_change ON change_proposals(task_id) WHERE status='pending';
CREATE TABLE change_decisions(proposal_id TEXT NOT NULL REFERENCES change_proposals(id),member_id TEXT NOT NULL REFERENCES members(id),document TEXT NOT NULL CHECK(json_valid(document)),PRIMARY KEY(proposal_id,member_id)) STRICT;
CREATE TABLE artifacts(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),uploader_id TEXT NOT NULL REFERENCES members(id),status TEXT NOT NULL CHECK(status IN ('available','revoked')),version INTEGER NOT NULL,blob_key TEXT NOT NULL UNIQUE,document TEXT NOT NULL CHECK(json_valid(document))) STRICT;
CREATE TABLE deliverable_artifacts(deliverable_id TEXT NOT NULL REFERENCES deliverables(id),artifact_id TEXT NOT NULL REFERENCES artifacts(id),artifact_version INTEGER NOT NULL,PRIMARY KEY(deliverable_id,artifact_id)) STRICT;
CREATE TABLE artifact_revocations(artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id),actor_id TEXT NOT NULL REFERENCES members(id),reason TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
CREATE TRIGGER coordination_task_dependencies_insert AFTER INSERT ON task_dependencies
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER coordination_task_dependencies_update AFTER UPDATE ON task_dependencies
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER coordination_task_dependencies_delete AFTER DELETE ON task_dependencies
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER coordination_dependency_bindings_insert AFTER INSERT ON dependency_bindings
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER coordination_dependency_bindings_update AFTER UPDATE ON dependency_bindings
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER coordination_dependency_bindings_delete AFTER DELETE ON dependency_bindings
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER coordination_dependency_impacts_insert AFTER INSERT ON dependency_impacts
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER coordination_dependency_impacts_update AFTER UPDATE ON dependency_impacts
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER coordination_dependency_impacts_delete AFTER DELETE ON dependency_impacts
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER coordination_change_proposals_insert AFTER INSERT ON change_proposals
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER coordination_change_proposals_update AFTER UPDATE ON change_proposals
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER coordination_change_proposals_delete AFTER DELETE ON change_proposals
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER coordination_artifacts_insert AFTER INSERT ON artifacts
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER coordination_artifacts_update AFTER UPDATE ON artifacts
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER coordination_artifacts_delete AFTER DELETE ON artifacts
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
