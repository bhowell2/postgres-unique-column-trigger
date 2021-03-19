# Postgres Unique Column (Per Group) Trigger
Simple Postgres's function that creates a trigger to ensure only one column in a group is a unique value. Multiple of 
these triggers can be created for different columns.

One use case would be for ensuring only one payment method for a user is set to the default.

This is provided via copy-paste [unique.sql](unique.sql), no extension available.

## Example
This is the most basic example.

```postgresql
fn_create_unique_column_per_group_trigger(
  tableName,
  uniqueColumn,
  uniqueValue,  -- when using text columns may need to cast this
  defaultValue,
  groupColumn,
  createUniqueIndex = FALSE,
  hashCreatedIdentifiers = FALSE
);
```

```postgresql
CREATE TABLE tst_tab (
  id integer,
  /*
    The user will likely want this indexed anyway, but if it is not and if 
    createUniqueIndex = TRUE (creates a partial index on the groupColumn that 
    has the unique value) is not used then the trigger could take a while 
    to set the other uniqueValue in the group to the defaultValue.
  */
  group_id integer, 
  only_one_main text
);
SELECT fn_create_unique_column_per_group_trigger(
  'tst_tab',
  'only_one_main',
  'main',
  NULL,
  'group_id'
);
INSERT INTO tst_tab (id, group_id, only_one_main) VALUES (1, 1, 'not main');
INSERT INTO tst_tab (id, group_id, only_one_main) VALUES (2, 1, 'main');
INSERT INTO tst_tab (id, group_id, only_one_main) VALUES (3, 1, 'main');  -- causes only_one_main will be set to NULL on id = 2

SELECT * FROM tst_tab WHERE group_id = 1 AND only_one_main = 'main';  -- returns id = 3
UPDATE tst_tab SET only_one_main = 'main' where id = 1; -- only_one_main will be set to NULL on id = 3
SELECT * FROM tst_tab WHERE group_id = 1 AND only_one_main = 'main';  -- returns id = 1
DELETE FROM tst_tab WHERE id = 1; -- leaves no 'main' value for group_id = 1
SELECT * FROM tst_tab WHERE group_id = 1 AND only_one_main = 'main';  -- returns nothing
```

## The Code. Can copy from [unique.sql](unique.sql).
```postgresql
/*
  Creates a trigger that ensures only one row in the group has some uniqueValue,
  setting the other uniqueColumn in the group to defaultValue when a new uniqueValue 
  for the group is being inserted or updated.
*/
CREATE OR REPLACE FUNCTION fn_create_unique_column_per_group_trigger(
  /*
    Name of table for which this constraint trigger should be created...
  */
  tableName text,
  /*
    The column that can only have one uniqueValue per groupColumn.
  */
  uniqueColumn text,
  /*
    Value that should be unique for uniqueColumn per groupColumn.
    I.e.,
    'SELECT * FROM tableName WHERE uniqueColumn = uniqueValue AND groupColumn = 'whatever';' should
    always return 1 row.
  */
  uniqueValue anyelement,
  /*
    Default value to set uniqueColumn to when a row is inserted or updated with uniqueValue
    for the groupColumn.
  */
  defaultValue anyelement,
  /*
    The column that indicates a group for which a value on uniqueColumn should be unique.
  */
  groupColumn text,
  /*
    Whether or not to create a unique (partial) index on the table's group column with
    the unique value. This will ensure that if the table already exists with data that
    they do not validate the constraint created by this trigger.
  */
  createUniqueIndex boolean = FALSE,
  /*
    In the case that the user has long table or column names and will create multiple
    of this same trigger on a table they may need to hash the created trigger, function,
    and index to avoid identifiers overriding each other in subsequent calls to create
    the default column triggers.

    If this can be avoided it should as it will create less than ideal trigger and function
    names that might confuse you later on...

    You can adapt any of this code to create your own naming conventions if you wish.
  */
  hashCreatedIdentifiers boolean = FALSE
) RETURNS VOID AS $f1$
DECLARE
  trg_name text;
  trg_fn_name text;
  unique_index_name text;
  execute_create_fn_statement text;
BEGIN

  trg_name := FORMAT('trg_%s_check_unique_on_%s', tableName, uniqueColumn);
  trg_fn_name := FORMAT('trg_fn_%s_check_unique_on_%s', tableName, uniqueColumn);

  IF hashCreatedIdentifiers THEN
    trg_name := 'trg_def_column_' || SUBSTRING(MD5(trg_name), 1, 15);
    trg_fn_name := 'trg_fn_def_column' || SUBSTRING(MD5(trg_fn_name), 1, 15);
  END IF;


  /*
    The created function looks like:

    CREATE OR REPLACE FUNCTION trg_fn_name() RETURNS TRIGGER AS $t$
    BEGIN
      IF tg_op = 'INSERT' THEN
        IF new.uniqueColumn IS NOT DISTINCT FROM uniqueValue THEN
          UPDATE tableName SET uniqueColumn = defaultValue WHERE
          groupColumn IS NOT DISTINCT FROM new.groupColumn AND uniqueColumn IS NOT DISTINCT FROM uniqueValue;
        END IF;
      ELSIF tg_op = 'UPDATE' THEN
        IF new.uniqueColumn IS NOT DISTINCT FROM uniqueValue AND
        (new.uniqueColumn IS DISTINCT FROM old.uniqueColumn
        OR new.groupColumn IS DISTINCT FROM old.groupColumn) THEN
          UPDATE tableName SET uniqueColumn = defaultValue WHERE
          groupColumn IS NOT DISTINCT FROM new.groupColumn AND uniqueColumn IS NOT DISTINCT FROM uniqueValue;
        END IF;
      END IF;
  */

  execute_create_fn_statement :=
      'CREATE OR REPLACE FUNCTION ' || QUOTE_IDENT(trg_fn_name) || '() RETURNS TRIGGER AS $t$'
          || ' BEGIN '
          || '  IF tg_op = ''INSERT'' THEN '
          || '    IF new.' || QUOTE_IDENT(uniqueColumn) || ' IS NOT DISTINCT FROM '|| quote_nullable(uniqueValue) || ' THEN '
          || '      UPDATE ' || QUOTE_IDENT(tableName) || ' SET '
          ||        QUOTE_IDENT(uniqueColumn) || ' = ' || quote_nullable(defaultValue)
          || '      WHERE ' || QUOTE_IDENT(groupColumn) || ' IS NOT DISTINCT FROM new.' || QUOTE_IDENT(groupColumn)
          || '      AND ' || QUOTE_IDENT(uniqueColumn) || ' IS NOT DISTINCT FROM ' || quote_nullable(uniqueValue) || ';'
          || '    END IF;'
          || '  ELSIF tg_op = ''UPDATE'' THEN '
          || '    IF new.' || QUOTE_IDENT(uniqueColumn) || ' IS NOT DISTINCT FROM ' || quote_nullable(uniqueValue) ||  ' AND '
          || '    (new.' || QUOTE_IDENT(uniqueColumn) || ' IS DISTINCT FROM old.' || QUOTE_IDENT(uniqueColumn) || ' OR '
          || '    new.' || QUOTE_IDENT(groupColumn) || ' IS DISTINCT FROM old.' || QUOTE_IDENT(groupColumn) || ') THEN '
          || '      UPDATE ' || QUOTE_IDENT(tableName) || ' SET '
          ||        QUOTE_IDENT(uniqueColumn) || ' = ' || quote_nullable(defaultValue)
          || '      WHERE ' || QUOTE_IDENT(groupColumn) || ' IS NOT DISTINCT FROM new.' || QUOTE_IDENT(groupColumn)
          || '      AND ' || QUOTE_IDENT(uniqueColumn) || ' IS NOT DISTINCT FROM ' || quote_nullable(uniqueValue) || ';'
          || '    END IF;'
          || '  END IF; '
          || '  RETURN new;'
          || ' END; '
          || ' $t$ LANGUAGE plpgsql;';

  IF createUniqueIndex THEN

    unique_index_name := FORMAT('idx_%s_unique_%s_per_%s', tableName, uniqueColumn, groupColumn);

    IF hashCreatedIdentifiers THEN
      unique_index_name := 'idx_unique_def_column_' || SUBSTRING(MD5(unique_index_name), 1, 15);
    END IF;

    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS ' || unique_index_name
        || ' ON ' || QUOTE_IDENT(tableName) || '(' || QUOTE_IDENT(groupColumn) || ') '
        || ' WHERE ' || QUOTE_IDENT(uniqueColumn) || ' IS NOT DISTINCT FROM ' || uniqueValue || ';';
  END IF;

  EXECUTE execute_create_fn_statement;

  EXECUTE 'DROP TRIGGER IF EXISTS ' || QUOTE_IDENT(trg_name) || ' ON ' || QUOTE_IDENT(tableName);

  EXECUTE 'CREATE TRIGGER ' || QUOTE_IDENT(trg_name) || ' '
      || 'BEFORE INSERT OR UPDATE '
      || 'ON ' || QUOTE_IDENT(tableName) || ' '
      || 'FOR EACH ROW EXECUTE PROCEDURE ' || QUOTE_IDENT(trg_fn_name) || '();';

END; $f1$ LANGUAGE plpgsql;

```