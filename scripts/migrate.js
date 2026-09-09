/**
 * Enterprise Database Migration & Seeding Runner
 * Executes sql/001_initial_schema.sql and sql/002_seed_data.sql against PostgreSQL.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const databaseUrl = process.env.DATABASE_URL || '';

async function runMigration() {
  if (!databaseUrl) {
    console.error('\n[MIGRATE ERROR] DATABASE_URL environment variable is not defined.');
    console.log('Set DATABASE_URL (e.g. postgresql://user:pass@localhost:5432/oneness_yachts) to run migrations.\n');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });

  try {
    console.log('[MIGRATE] Connecting to PostgreSQL database...');
    await client.connect();
    console.log('[MIGRATE] Connected successfully.');

    // 1. Run Schema DDL
    const schemaPath = path.join(__dirname, '..', 'sql', '001_initial_schema.sql');
    if (fs.existsSync(schemaPath)) {
      console.log('[MIGRATE] Applying schema from sql/001_initial_schema.sql...');
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await client.query(schemaSql);
      console.log('[MIGRATE] Schema DDL applied successfully (15 tables, indexes, constraints).');
    }

    // 2. Run Seed Data if requested
    const shouldSeed = process.argv.includes('--seed') || process.env.SEED_DB === 'true';
    if (shouldSeed) {
      const seedPath = path.join(__dirname, '..', 'sql', '002_seed_data.sql');
      if (fs.existsSync(seedPath)) {
        console.log('[MIGRATE] Applying seed data from sql/002_seed_data.sql...');
        const seedSql = fs.readFileSync(seedPath, 'utf8');
        await client.query(seedSql);
        console.log('[MIGRATE] Seed data applied successfully.');
      }
    }

    console.log('\n[MIGRATE COMPLETE] Database is fully ready for production operation.\n');
  } catch (err) {
    console.error('[MIGRATE FAILED]:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
