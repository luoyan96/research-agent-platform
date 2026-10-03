CREATE TABLE lab_ai_settings (
 lab_id TEXT PRIMARY KEY REFERENCES labs(id),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 model TEXT NOT NULL CHECK(model IN ('deepseek-flash','deepseek-v4-pro')),
 encrypted_api_key TEXT,
 version INTEGER NOT NULL CHECK(version > 0),
 updated_by TEXT NOT NULL REFERENCES members(id),
 updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE lab_ai_setting_receipts (
 actor_id TEXT NOT NULL REFERENCES members(id),
 lab_id TEXT NOT NULL REFERENCES labs(id),
 request_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 response_json TEXT NOT NULL CHECK(json_valid(response_json)),
 created_at TEXT NOT NULL,
 PRIMARY KEY(actor_id,lab_id,request_key)
) STRICT;
