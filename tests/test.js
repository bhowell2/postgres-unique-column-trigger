const {Client} = require('pg');
const fs = require('fs');
const path = require('path');

async function setupClient() {
  const client = new Client({
                              user: 'postgres',
                              host: 'localhost',
                              database: 'postgres',
                              password: 'postgres',
                              port: 5432,
                            });
  try {
    await client.connect();
    await client.query("DROP SCHEMA IF EXISTS public cascade");
    await client.query("CREATE SCHEMA public");
    const createDefaultFunctionSql = fs.readFileSync(path.resolve('../unique.sql')).toString();
    await client.query(createDefaultFunctionSql);
    const initialTestData = fs.readFileSync(path.resolve("./testdata.sql")).toString();
    await client.query(initialTestData);
    return client;
  } catch (e) {
    client.end();
    console.error(e);
    throw e;
  }
}

let pgClient = null;

beforeEach(async () => {
  pgClient = await setupClient();
});

afterEach(async () => {
  await pgClient.end();
});

const BOOL_TABLE = "test_bool_default_column";
const INT_TABLE = "test_int_default_column";
const TEXT_TABLE = "test_text_default_column";

const COL_ID = "id";
const COL_GROUP_ID = "group_id";
const COL_UNIQUE_PER_GROUP = "unique_per_group";

/**
 * Returns the result
 */
function insertForTable(tableName, id, groupId, uniquePerGroupVal) {
  return pgClient
    .query(`INSERT INTO ${tableName} (id, group_id, unique_per_group) VALUES (${id}, ${groupId}, ${uniquePerGroupVal})`)
    .then(resp => ({  // dont care about response
      id,
      groupId,
      uniquePerGroupVal
    }));
}

function updateForTable(tableName, cols) {
  let updateStr = "UPDATE " + tableName + " SET ";
  let hasSetBefore = false;
  if (cols[COL_GROUP_ID] !== undefined) {
    updateStr += `${COL_GROUP_ID} = ${cols[COL_GROUP_ID]} `;
    hasSetBefore = true;
  }
  if (cols[COL_UNIQUE_PER_GROUP] !== undefined) {
    if (hasSetBefore) {
      updateStr += ',';
    }
    updateStr += `${COL_UNIQUE_PER_GROUP} = ${cols[COL_UNIQUE_PER_GROUP]} `;
  }
  if (cols[COL_ID] === undefined) {
    throw new Error("Must supply column ID to update function. It is used for update condition.");
  }
  updateStr += `WHERE ${COL_ID} = ${cols[COL_ID]}`;
  return pgClient.query(updateStr);
}

test("Check only one default is set on unique bool per group.", async () => {

  /*
  * In testdata.sql a unique value of true is required per group.
  * */

  await insertForTable(BOOL_TABLE, 1, 1, false);
  await insertForTable(BOOL_TABLE, 2, 1, false);
  await insertForTable(BOOL_TABLE, 3, 1, true);
  const query1 = await pgClient.query(`SELECT * FROM ${BOOL_TABLE} WHERE ${COL_UNIQUE_PER_GROUP} = true`);

  expect(query1.rowCount).toEqual(1);
  expect(query1.rows[0][COL_ID]).toEqual(3);

  await insertForTable(BOOL_TABLE, 4, 1, true);
  const query2 = await pgClient.query(`SELECT * FROM ${BOOL_TABLE} WHERE ${COL_UNIQUE_PER_GROUP} = true`);

  expect(query2.rowCount).toEqual(1);
  expect(query2.rows[0][COL_ID]).toEqual(4);

  /*
  * Inserting id = 5, group = 1, unique = true.
  * Inserting id = 6, group = 2, unique = true.
  * Inserting id = 7, group = 2, unique = true.
  * Inserting id = 8, group = 2, unique = true.
  *
  * Should only have id 5 and id 8 as true.
  * */

  await insertForTable(BOOL_TABLE, 5, 1, true);

  await insertForTable(BOOL_TABLE, 6, 2, true);
  await insertForTable(BOOL_TABLE, 7, 2, true);
  await insertForTable(BOOL_TABLE, 8, 2, true);

  const query3 = await pgClient.query(`SELECT * FROM ${BOOL_TABLE} WHERE ${COL_UNIQUE_PER_GROUP} = true`);

  /*
  * In this case row count should be 2, because another group id (2) has been inserted
  * and it has a value of true.
  * */
  expect(query3.rowCount).toEqual(2);
  expect(query3.rows[0][COL_ID] === 5 || query3.rows[0][COL_ID] === 8).toBeTruthy();
  expect(query3.rows[1][COL_ID] === 5 || query3.rows[1][COL_ID] === 8).toBeTruthy();

  await insertForTable(BOOL_TABLE, 9, 3, false);

  const query4 = await pgClient.query(`SELECT * FROM ${BOOL_TABLE} WHERE ${COL_UNIQUE_PER_GROUP} = true`);

  /*
  * In this case row count should be 2, because another group id (2) has been inserted
  * and it has a value of true. Another group id (3) has been inserted at this point,
  * but it does not have its unique value set.
  * */
  expect(query4.rowCount).toEqual(2);
  expect(query4.rows[0][COL_ID] === 5 || query4.rows[0][COL_ID] === 8).toBeTruthy();
  expect(query4.rows[1][COL_ID] === 5 || query4.rows[1][COL_ID] === 8).toBeTruthy();


  /*
  * Change id = 3, group = 1 to be unique. (was id 5)
  * Change id = 6, group = 2 to be unique. (was id 8)
  * Change id = 9, group = 3 to be in group 2. (was group 3).
  * The last change should not have caused anything to happen.
  * */
  await updateForTable(BOOL_TABLE, {[COL_ID]: 3, [COL_UNIQUE_PER_GROUP]: true});
  await updateForTable(BOOL_TABLE, {[COL_ID]: 6, [COL_UNIQUE_PER_GROUP]: true});
  await updateForTable(BOOL_TABLE, {[COL_ID]: 9, [COL_GROUP_ID]: 2});

  const query5 = await pgClient.query(`SELECT * FROM ${BOOL_TABLE} WHERE ${COL_UNIQUE_PER_GROUP} = true`);

  /*
  * In this case row count should be 2, because another group id (2) has been inserted
  * and it has a value of true. Another group id (3) has been inserted at this point,
  * but it does not have its unique value set.
  * */
  expect(query5.rowCount).toEqual(2);
  expect(query5.rows[0][COL_ID] === 3 || query5.rows[0][COL_ID] === 6).toBeTruthy();
  expect(query5.rows[1][COL_ID] === 3 || query5.rows[1][COL_ID] === 6).toBeTruthy();

  /*
  * Change unique of group 1 to be in group 2. This should cause the only true
  * value to be in group 2 now.
  * */
  await updateForTable(BOOL_TABLE, {[COL_ID]: 3, [COL_GROUP_ID]: 2});

  const query6 = await pgClient.query(`SELECT * FROM ${BOOL_TABLE} WHERE ${COL_UNIQUE_PER_GROUP} = true`);

  /*
  * In this case row count should be 2, because another group id (2) has been inserted
  * and it has a value of true. Another group id (3) has been inserted at this point,
  * but it does not have its unique value set.
  * */
  expect(query6.rowCount).toEqual(1);
  expect(query6.rows[0][COL_ID] === 3).toBeTruthy();

});


test("Check only one default is set on unique integer per group.", async () => {
  /*
  * In the testdata, 1 has been set to be the unique value per group.
  * */
  await insertForTable(INT_TABLE, 1, 1, 1);
  await insertForTable(INT_TABLE, 2, 1, 5);
  await insertForTable(INT_TABLE, 3, 1, 1);

  const query1 = await pgClient.query(`SELECT * FROM ${INT_TABLE} WHERE ${COL_UNIQUE_PER_GROUP} = 1`);

  expect(query1.rowCount).toEqual(1);
  expect(query1.rows[0][COL_ID] === 3).toBeTruthy();

  /*
  * Inserting a new value for group 2 with unique = 1.
  * Changing id = 2 to be in group 2 with unique = 1, which should override previous insert.
  * */

  await updateForTable(INT_TABLE, {[COL_ID]: 1, [COL_UNIQUE_PER_GROUP]: 1});
  await insertForTable(INT_TABLE, 4, 2, 1);
  await updateForTable(INT_TABLE, {[COL_ID]: 2, [COL_UNIQUE_PER_GROUP]: 1, [COL_GROUP_ID]: 2});

  const query2 = await pgClient.query(`SELECT * FROM ${INT_TABLE} WHERE ${COL_UNIQUE_PER_GROUP} = 1`);

  expect(query2.rowCount).toEqual(2);
  expect(query2.rows[0][COL_ID] === 1 || query2.rows[0][COL_ID] === 2).toBeTruthy();
  expect(query2.rows[1][COL_ID] === 1 || query2.rows[1][COL_ID] === 2).toBeTruthy();

});

test("Check only one default is set on unique string and only one null is set for each group.", async () => {
  /*
  * The text default table has a unique value of 'unique' set for the unique_per_group
  * column and another unique value of NULL set for the unique_null_per_group.
  * */

  const COL_UNIQUE_NULL_PER_GROUP = "unique_null_per_group";

  /*
  * - Insert id = 1, group = 1, unique_per_group = 'hi' (not unique), the default of
  *   unique_null_per_group is null and this is unique when not set. (the next insert should
  *   override this and the value of the unique_null_per_group column should be 'not null').
  * - Insert id = 2, group = 1, unique_per_group = 'unique' (should be unique) and
  *   like the last insert the default of unique_null_per_group is NULL and thus should be
  *   the only null for column unique_null_per_group, causing id=1 to have been overriden with 'not null'.
  * */
  await pgClient.query(`INSERT INTO ${TEXT_TABLE} (${COL_ID}, ${COL_GROUP_ID}, ${COL_UNIQUE_PER_GROUP}) VALUES (1, 1, 'hi')`);

  await pgClient.query(`INSERT INTO ${TEXT_TABLE} (${COL_ID}, ${COL_GROUP_ID}, ${COL_UNIQUE_PER_GROUP}) VALUES (2, 1, 'unique')`);

  const query1 = await pgClient.query(`SELECT * FROM ${TEXT_TABLE}`);

  const rows = query1.rows;
  expect(rows.length).toEqual(2);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][COL_ID] === 1) {
      expect(rows[i][COL_UNIQUE_PER_GROUP]).toEqual('hi');
      // should have been overridden here
      expect(rows[i][COL_UNIQUE_NULL_PER_GROUP]).toEqual('not null');
    } else if (rows[i][COL_ID] === 2) {
      expect(rows[i][COL_UNIQUE_PER_GROUP]).toEqual('unique');
      // should have been overridden here
      expect(rows[i][COL_UNIQUE_NULL_PER_GROUP]).toEqual(null);
    } else {
      fail("Should not have happened.")
    }
  }

  await pgClient.query(`INSERT INTO ${TEXT_TABLE} (${COL_ID}, ${COL_GROUP_ID}, ${COL_UNIQUE_PER_GROUP}, ${COL_UNIQUE_NULL_PER_GROUP}) VALUES (3, 1, 'unique', 'whatever')`);


  const query2 = await pgClient.query(`SELECT * FROM ${TEXT_TABLE}`);

  const rows2 = query2.rows;
  expect(rows2.length).toEqual(3);
  for (let i = 0; i < rows2.length; i++) {
    if (rows2[i][COL_ID] === 1) {
      expect(rows2[i][COL_UNIQUE_PER_GROUP]).toEqual('hi');
      // should have been overridden here
      expect(rows2[i][COL_UNIQUE_NULL_PER_GROUP]).toEqual('not null');
    } else if (rows2[i][COL_ID] === 2) {
      // should have been set to null, because unique default overridden by id = 3
      expect(rows2[i][COL_UNIQUE_PER_GROUP]).toEqual(null);
      // should have been overridden here
      expect(rows2[i][COL_UNIQUE_NULL_PER_GROUP]).toEqual(null);
    } else if (rows2[i][COL_ID] === 3) {
      // should have been set to null, because unique default overridden by id = 3
      expect(rows2[i][COL_UNIQUE_PER_GROUP]).toEqual('unique');
      // should have been overridden here
      expect(rows2[i][COL_UNIQUE_NULL_PER_GROUP]).toEqual('whatever');
    } else {
      fail("Should not have happened.")
    }
  }

});


test("Check unique index created with function.", async () => {
  const tableName = "test_unique_idx_creation";
  await pgClient.query(`CREATE TABLE ${tableName} (id integer, group_id integer, unique_per_group boolean)`);
  await pgClient.query(`INSERT INTO ${tableName} values (1,1, true)`);
  await pgClient.query(`INSERT INTO ${tableName} values (2,1, true)`);
  await pgClient.query(`INSERT INTO ${tableName} values (3,1, false)`);
  // this should fail
  let didFail = false;
  try {
    await pgClient.query(`SELECT fn_create_default_column_trigger(${tableName}, 'unique_per_group', true, false, 'group_id', true)`);
  } catch (e) {
    didFail = true;
  }
  expect(didFail).toBeTruthy();
});
