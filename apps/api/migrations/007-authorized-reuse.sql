CREATE TABLE conclusions (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), owner_id TEXT NOT NULL REFERENCES members(id),
 head_version INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE conclusion_versions (
 conclusion_id TEXT NOT NULL REFERENCES conclusions(id), version INTEGER NOT NULL,
 document TEXT NOT NULL CHECK(json_valid(document)), PRIMARY KEY(conclusion_id,version)
) STRICT;
CREATE TABLE reuse_edges (
 target_kind TEXT NOT NULL CHECK(target_kind IN ('task','plan','job')), target_id TEXT NOT NULL,
 conclusion_id TEXT NOT NULL, revision INTEGER NOT NULL,
 PRIMARY KEY(target_kind,target_id,conclusion_id,revision),
 FOREIGN KEY(conclusion_id,revision) REFERENCES conclusion_versions(conclusion_id,version)
) STRICT;
CREATE TABLE public_samples (
 id TEXT PRIMARY KEY, lab_id TEXT NOT NULL REFERENCES labs(id), owner_id TEXT NOT NULL REFERENCES members(id),
 task_id TEXT NOT NULL REFERENCES tasks(id), status TEXT NOT NULL, version INTEGER NOT NULL,
 document TEXT NOT NULL CHECK(json_valid(document)), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE sample_edges (
 target_kind TEXT NOT NULL CHECK(target_kind IN ('task','plan','job')),target_id TEXT NOT NULL,
 sample_id TEXT NOT NULL REFERENCES public_samples(id), PRIMARY KEY(target_kind,target_id,sample_id)
) STRICT;
CREATE TABLE public_methods (
 lab_id TEXT NOT NULL REFERENCES labs(id), version INTEGER NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)),
 PRIMARY KEY(lab_id,version)
) STRICT;
CREATE TABLE public_method_state (
 lab_id TEXT PRIMARY KEY REFERENCES labs(id), active_version INTEGER NOT NULL,
 FOREIGN KEY(lab_id,active_version) REFERENCES public_methods(lab_id,version)
) STRICT;
CREATE TABLE method_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, lab_id TEXT NOT NULL REFERENCES labs(id),
 method_version INTEGER NOT NULL, generation INTEGER NOT NULL, action TEXT NOT NULL,
 actor_id TEXT REFERENCES members(id), run_id TEXT, at TEXT NOT NULL
) STRICT;
INSERT INTO public_methods SELECT lab_id,1,json_object('version',1,'capabilityId',id,'labId',lab_id,'config',json('{"emphasis":"metrics","detail":"concise","citations":"exact_quote"}'),'sampleIds',json('[]'),'createdBy',NULL,'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'origin','legacy_b3','usable',json('true')) FROM public_capabilities;
INSERT INTO public_method_state SELECT lab_id,1 FROM public_capabilities;
INSERT INTO method_events(lab_id,method_version,generation,action,actor_id,run_id,at) SELECT lab_id,1,version,'legacy_import',NULL,NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM public_capabilities;
-- Existing capability.version remains configuration generation. This does not fabricate a method publication.
UPDATE execution_jobs SET document=json_set(document,'$.methodVersion',1,'$.configurationGeneration',json_extract(document,'$.capability.version'),'$.methodTrial',json('false'),'$.conclusionRefs',json('[]')) WHERE kind='capability';
CREATE TRIGGER method_initial_import AFTER INSERT ON public_capabilities BEGIN
 INSERT INTO public_methods VALUES(NEW.lab_id,1,json_object('version',1,'capabilityId',NEW.id,'labId',NEW.lab_id,'config',json('{"emphasis":"metrics","detail":"concise","citations":"exact_quote"}'),'sampleIds',json('[]'),'createdBy',NULL,'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'origin','legacy_b3','usable',json('true')));
 INSERT INTO public_method_state VALUES(NEW.lab_id,1);
 INSERT INTO method_events(lab_id,method_version,generation,action,at) VALUES(NEW.lab_id,1,NEW.version,'legacy_import',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE VIEW reuse_closure AS
 WITH RECURSIVE paths(target_kind,target_id,conclusion_id,revision) AS (
 SELECT target_kind,target_id,conclusion_id,revision FROM reuse_edges
 UNION
 SELECT p.target_kind,p.target_id,e.conclusion_id,e.revision FROM paths p JOIN conclusions c ON c.id=p.conclusion_id JOIN reuse_edges e ON e.target_kind='task' AND e.target_id=c.task_id
 ) SELECT * FROM paths;
CREATE VIEW conclusion_denials AS
 SELECT c.id AS conclusion_id,v.version AS revision,m.id AS member_id FROM conclusions c
 JOIN conclusion_versions v ON v.conclusion_id=c.id JOIN tasks t ON t.id=c.task_id
 JOIN members m ON m.lab_id=t.lab_id LEFT JOIN task_access a ON a.task_id=t.id AND a.member_id=m.id
 WHERE c.revoked=1 OR t.status='cancelled' OR COALESCE(a.access,'')!='full'
 OR (json_extract(v.document,'$.scope')='owner_only' AND m.id!=c.owner_id)
 OR EXISTS(SELECT 1 FROM json_each(v.document,'$.artifactRefs') ref LEFT JOIN artifacts f ON f.id=json_extract(ref.value,'$.id') WHERE f.id IS NULL OR f.status!='available' OR f.version!=json_extract(ref.value,'$.version'));
CREATE VIEW invalid_samples AS
 SELECT s.id FROM public_samples s JOIN tasks t ON t.id=s.task_id LEFT JOIN task_access a ON a.task_id=t.id AND a.member_id=s.owner_id
 LEFT JOIN deliverables d ON d.id=json_extract(s.document,'$.deliverable.id')
 WHERE s.status!='available' OR COALESCE(a.access,'')!='full' OR t.version!=json_extract(s.document,'$.sourceTaskVersion')
 OR d.version!=json_extract(s.document,'$.deliverable.version') OR json_extract(d.document,'$.review.decision')!='accepted'
 OR EXISTS(SELECT 1 FROM json_each(d.document,'$.artifactRefs') ref LEFT JOIN artifacts f ON f.id=ref.value WHERE f.id IS NULL OR f.status!='available');
CREATE VIEW reuse_denials AS
 SELECT p.target_kind,p.target_id,d.member_id FROM reuse_closure p JOIN conclusion_denials d ON d.conclusion_id=p.conclusion_id AND d.revision=p.revision
 UNION
 SELECT e.target_kind,e.target_id,m.id FROM sample_edges e JOIN invalid_samples s ON s.id=e.sample_id CROSS JOIN members m
 UNION
 SELECT p.target_kind,p.target_id,m.id FROM reuse_closure p JOIN conclusions c ON c.id=p.conclusion_id JOIN sample_edges e ON e.target_kind='task' AND e.target_id=c.task_id JOIN invalid_samples s ON s.id=e.sample_id CROSS JOIN members m;
CREATE TRIGGER conclusion_revision AFTER INSERT ON conclusion_versions BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER conclusion_withdrawal AFTER UPDATE ON conclusions BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER reuse_revision AFTER INSERT ON reuse_edges BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER sample_revision AFTER UPDATE ON public_samples BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
CREATE TRIGGER method_revision AFTER INSERT ON public_methods BEGIN UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'; END;
