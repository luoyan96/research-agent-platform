CREATE TABLE invitation_decisions (
 assignment_id TEXT PRIMARY KEY REFERENCES assignments(id),
 member_id TEXT NOT NULL REFERENCES members(id),
 assignment_version INTEGER NOT NULL, task_version INTEGER NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('accepted','declined')),
 comment TEXT, decided_at TEXT NOT NULL
) STRICT;
