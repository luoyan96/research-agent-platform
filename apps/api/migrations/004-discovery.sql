-- Preserve B1 documents, stable task IDs, passwords, sessions and history.
CREATE TABLE member_availability (
  member_id TEXT PRIMARY KEY REFERENCES members(id),
  document TEXT NOT NULL CHECK(json_valid(document))
) STRICT;
CREATE INDEX plans_owner_history ON plans(owner_id,lab_id,json_extract(document,'$.status'),json_extract(document,'$.createdAt') DESC,id DESC);
-- Invalidate cross-request snapshots on every underlying business change,
-- including ACL changes and administrative repair; auth/health reads do not.
CREATE TRIGGER discovery_plans_insert AFTER INSERT ON plans
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_plans_update AFTER UPDATE ON plans
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_plans_delete AFTER DELETE ON plans
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_tasks_insert AFTER INSERT ON tasks
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_tasks_update AFTER UPDATE ON tasks
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_tasks_delete AFTER DELETE ON tasks
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_task_access_insert AFTER INSERT ON task_access
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_task_access_update AFTER UPDATE ON task_access
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_task_access_delete AFTER DELETE ON task_access
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_assignments_insert AFTER INSERT ON assignments
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_assignments_update AFTER UPDATE ON assignments
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_assignments_delete AFTER DELETE ON assignments
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_deliverables_insert AFTER INSERT ON deliverables
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_deliverables_update AFTER UPDATE ON deliverables
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_deliverables_delete AFTER DELETE ON deliverables
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_members_insert AFTER INSERT ON members
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_members_update AFTER UPDATE ON members
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_members_delete AFTER DELETE ON members
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_member_availability_insert AFTER INSERT ON member_availability
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_member_availability_update AFTER UPDATE ON member_availability
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER discovery_member_availability_delete AFTER DELETE ON member_availability
BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
