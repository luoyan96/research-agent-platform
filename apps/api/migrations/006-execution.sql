CREATE TABLE public_capabilities (
 lab_id TEXT NOT NULL REFERENCES labs(id), id TEXT NOT NULL, version INTEGER NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), owner_id TEXT NOT NULL REFERENCES members(id), PRIMARY KEY(lab_id,id)
) STRICT;
CREATE TABLE task_permissions (task_id TEXT PRIMARY KEY REFERENCES tasks(id), version INTEGER NOT NULL) STRICT;
INSERT INTO task_permissions SELECT id,1 FROM tasks;
CREATE TRIGGER execution_task_insert AFTER INSERT ON tasks BEGIN
 INSERT INTO task_permissions VALUES (NEW.id,1);
END;
CREATE TRIGGER execution_acl_insert AFTER INSERT ON task_access BEGIN
 UPDATE task_permissions SET version=version+1 WHERE task_id=NEW.task_id;
END;
CREATE TRIGGER execution_acl_update AFTER UPDATE ON task_access BEGIN
 UPDATE task_permissions SET version=version+1 WHERE task_id=NEW.task_id;
END;
CREATE TRIGGER execution_acl_delete AFTER DELETE ON task_access BEGIN
 UPDATE task_permissions SET version=version+1 WHERE task_id=OLD.task_id;
END;
CREATE TABLE execution_jobs (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('planning','capability')),
 owner_id TEXT NOT NULL REFERENCES members(id), lab_id TEXT NOT NULL REFERENCES labs(id),
 task_id TEXT REFERENCES tasks(id), status TEXT NOT NULL,
 version INTEGER NOT NULL, fence INTEGER NOT NULL DEFAULT 1,
 lease_owner TEXT, lease_until INTEGER, available_at INTEGER NOT NULL,
 request_json TEXT NOT NULL CHECK(json_valid(request_json)), document TEXT NOT NULL CHECK(json_valid(document)),
 created_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX one_active_capability ON execution_jobs(task_id)
 WHERE kind='capability' AND status IN ('queued','running','waiting_input');
CREATE INDEX execution_dispatch ON execution_jobs(status,available_at);
CREATE TABLE execution_attempts (
 job_id TEXT NOT NULL REFERENCES execution_jobs(id), attempt INTEGER NOT NULL,
 fence INTEGER NOT NULL, started_at TEXT NOT NULL, ended_at TEXT,
 request_json TEXT NOT NULL CHECK(json_valid(request_json)), result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
 PRIMARY KEY(job_id,attempt)
) STRICT;
CREATE TRIGGER execution_revision_insert AFTER INSERT ON execution_jobs BEGIN
 UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision';
END;
CREATE TRIGGER execution_revision_update AFTER UPDATE ON execution_jobs BEGIN
 UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision';
END;
CREATE TRIGGER capability_revision_update AFTER UPDATE ON public_capabilities BEGIN
 UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision';
END;
