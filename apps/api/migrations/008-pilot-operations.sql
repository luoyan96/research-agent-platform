CREATE TABLE account_controls (
 member_id TEXT PRIMARY KEY REFERENCES members(id), version INTEGER NOT NULL CHECK(version>0)
) STRICT;
INSERT INTO account_controls SELECT member_id,1 FROM auth_accounts;
CREATE TRIGGER account_control_insert AFTER INSERT ON auth_accounts BEGIN
 INSERT INTO account_controls VALUES(NEW.member_id,1);
END;
CREATE TABLE maintenance_audit (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE,
 operator TEXT NOT NULL, action TEXT NOT NULL, lab_id TEXT NOT NULL,
 member_id TEXT, request_hash TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)), at TEXT NOT NULL
) STRICT;
CREATE TRIGGER account_control_revision AFTER UPDATE ON account_controls BEGIN
 UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision';
END;
