// Railway PostGIS enablement script
// Run this before the main app starts to ensure PostGIS is available

const { Client } = require('pg');

async function enablePostGIS() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : undefined,
  });

  try {
    await client.connect();
    console.log('Connected to database, attempting to enable PostGIS...');

    await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
    console.log('✓ PostGIS extension enabled successfully');

    // Verify it worked
    const result = await client.query(
      "SELECT PostGIS_Version() as version"
    );
    console.log('✓ PostGIS version:', result.rows[0].version);

  } catch (error) {
    console.error('✗ Failed to enable PostGIS:', error.message);
    console.error('Please enable PostGIS manually in Railway dashboard');
    process.exit(1);
  } finally {
    await client.end();
  }
}

enablePostGIS();
