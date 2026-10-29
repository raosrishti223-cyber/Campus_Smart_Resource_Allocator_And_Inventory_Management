USE campus_resources;

CREATE TEMPORARY TABLE ddl_demo_scratch (
  demo_id INT PRIMARY KEY,
  label VARCHAR(40) NOT NULL
);

ALTER TABLE ddl_demo_scratch
  ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

DROP TEMPORARY TABLE ddl_demo_scratch;
