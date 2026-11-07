const { DBSQLClient } = require('@databricks/sql');

const serverHostname = process.env.DATABRICKS_SERVER_HOSTNAME;
const httpPath = process.env.DATABRICKS_HTTP_PATH;
const token = process.env.DATABRICKS_TOKEN;

if (!token || !serverHostname || !httpPath) {
  throw new Error(
    'Cannot find Server Hostname, HTTP Path, or ' +
      'personal access token. ' +
      'Check the environment variables DATABRICKS_SERVER_HOSTNAME, ' +
      'DATABRICKS_HTTP_PATH, and DATABRICKS_TOKEN.',
  );
}

const client = new DBSQLClient();
const connectOptions = {
  token: token,
  host: serverHostname,
  path: httpPath,
};

client.connect(connectOptions);
// ...