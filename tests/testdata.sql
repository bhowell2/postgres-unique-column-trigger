CREATE TABLE IF NOT EXISTS test_bool_default_column (
  id               INTEGER PRIMARY KEY,
  group_id         INTEGER NOT NULL,
  unique_per_group BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS test_int_default_column (
  id               INTEGER PRIMARY KEY,
  group_id         INTEGER NOT NULL,
  unique_per_group integer DEFAULT -1
);

CREATE TABLE IF NOT EXISTS test_text_default_column (
  id                    INTEGER PRIMARY KEY,
  group_id              INTEGER NOT NULL,
  unique_per_group      TEXT,
  unique_null_per_group TEXT
);


SELECT fn_create_unique_column_per_group_trigger(
           'test_bool_default_column',
           'unique_per_group',
           TRUE, -- only 1 true can exists per group
           FALSE,
           'group_id'
         );

SELECT fn_create_unique_column_per_group_trigger(
           'test_int_default_column',
           'unique_per_group',
           1, -- only 1 true can exists per group
           -1,
           'group_id',
           TRUE  -- creates unique index
         );

SELECT fn_create_unique_column_per_group_trigger(
           'test_text_default_column',
           'unique_per_group',
           'unique'::text, -- only value of 'unique' can exists per group
           null,
           'group_id'
         );

SELECT fn_create_unique_column_per_group_trigger(
           'test_text_default_column',
           'unique_null_per_group',
           null::text, -- only 1 value of null can exists for unique_null_per_group column per group
           'not null',
           'group_id'
         );
