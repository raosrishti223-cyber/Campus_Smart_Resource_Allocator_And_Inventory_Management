# CampusFlow — Campus Smart Resource Allocation & Inventory Management

CampusFlow helps campus departments find available resources across locations, protect local minimum stock, fulfill requests by reallocation, and record procurement only for an unmet remainder. It uses MySQL for transactional campus operations and MongoDB for flexible maintenance reports.

## Requirements

- Node.js 20.9 or newer
- MySQL 8.0.16 or newer
- MongoDB 6.0 or newer, with `mongosh`

## Local setup

1. Create a MySQL application account and database. Apply the schema as a database administrator; the application account itself needs only `SELECT`, `INSERT`, `UPDATE`, `DELETE`, and `EXECUTE` privileges on `campus_resources`.
2. Copy `.env.example` to `.env.local`. Set the MySQL and MongoDB connection values, a unique `AUTH_SECRET` of at least 32 characters, and separate seed passwords of at least 12 characters. The MySQL database is `campus_resources`; the MongoDB URI should use the separate database `campus_smart_resource_allocation` to match the setup script. Keep `.env.local` private: do not commit it or include it in a submission archive. The example file contains placeholders only and is safe to commit.
3. Apply the MySQL schema as a database administrator:

   ```sh
   mysql -u root -p < database/schema.sql
   ```

   In Windows PowerShell, run `Get-Content .\database\schema.sql | mysql -u root -p` from this project directory, or open `database/schema.sql` in MySQL Workbench and execute it.

   For the SQL-language demonstrations, run `database/ddl_demo.sql` and `database/demo-queries.sql` from MySQL Workbench or execute them with a database administrator account.

4. Configure the MongoDB collection, validator, and indexes:

   ```sh
   mongosh "$env:MONGODB_URI" .\database\mongodb.mongosh
   ```

   In PowerShell, `$env:MONGODB_URI` expands to the URI from the current shell. If it is not set there, use the same MongoDB URI configured in `.env.local` in place of the variable. Run the MongoDB server before starting the application. After changing `MONGODB_URI`, fully restart the Next.js development server so it reloads the configured database.

5. Install JavaScript dependencies and load sample campus data:

   ```sh
   npm install
   npm run db:seed
   ```

   The seed creates `admin@campus.local`, `staff@campus.local`, and `student@campus.local`, along with nine sample resources; sign in with the corresponding `SEED_ADMIN_PASSWORD`, `SEED_STAFF_PASSWORD`, or `SEED_STUDENT_PASSWORD` from `.env.local`. Run `npm run db:seed` again to add the sample resources to an existing database. The login page detects the account role automatically. Staff and students see only their own pending or partially fulfilled requests and do not see reallocation recommendations. Administrators see the campus-wide pending queue, reallocation recommendations, and separate fulfilled/withdrawn history sections; withdrawing an eligible request preserves it as a cancelled record for admin history. Request due dates must be today or later.

   Administrators can create additional staff and student logins from the **User accounts** section in the dashboard. Select one of the departments already configured in the database, enter the user's email and an initial password of at least 12 characters, then share those credentials securely. Admins can deactivate or reactivate accounts there; deactivation blocks access while preserving user and transaction history. Passwords are stored as bcrypt hashes; the admin account list never displays them.

   To add a repeatable, clearly named demo roster with 25 staff and 50 students across five departments, run `npm run db:seed:demo` after the regular seed. It creates any missing demo departments and locations, inserts the accounts into the same MySQL `users` table, and records each creation in `audit_events` as `USER_CREATED` by `admin@campus.local`. Re-running the command does not overwrite existing matching demo accounts. The demo credentials follow `staff01@campus.local` / `Staff01@Demo` through `staff25@campus.local` / `Staff25@Demo`, and `student01@campus.local` / `Student01@Demo` through `student50@campus.local` / `Student50@Demo`. These predictable credentials are for local testing only.

   For an existing installation, apply the migration once and then re-apply the updated schema as a database administrator (do not run the migration a second time):

   ```powershell
   Get-Content .\database\migrations\20261029_usage_tracking.sql | mysql -u root -p
   Get-Content .\database\schema.sql | mysql -u root -p
   ```

   This adds checked-out stock tracking and usage history without deleting inventory; the schema re-application refreshes its view, triggers, and transfer procedure. The app supports checkout/return for reusable resources and permanent usage for consumables. Staff and students see usage controls only for stock transferred to fulfill their own requests, at their department location; they can return only units they checked out. Each approved unit can be checked out once: returning it restores physical stock but does not restore that unit's checkout allowance. Any approved quantity not yet checked out remains available, and a later approved transfer adds new checkout allowance. Consumable use permanently reduces the approved quantity available. Administrators approve requests and transfers but cannot check out, return, or consume inventory. No additional migration is needed for request-scoped usage; it uses the existing transfer and usage records.

   To enable procurement order/receipt tracking on an existing database, apply `database/migrations/20261030_procurement_receiving.sql` once in MySQL Workbench. The admin-only Procurement section can mark recommendations ordered and receive each delivery into a selected active location. Receiving is transactional: it adds inventory and a `RECEIPT` stock transaction, records the destination and optional supplier, and marks the procurement received without allowing a second receipt. Received stock at Central Store can then be moved through the normal reallocation flow to fulfill the still-open request.

6. Start the web application:

   ```sh
   npm run dev
   ```

   Open `http://localhost:3000`.

7. Run checks:

   ```sh
   npm test
   npm run lint
   npm run build
   ```

   The integration checks need the configured services. For database procedure/trigger checks, create a disposable database named `campus_resources_test`, then apply the schema objects from `database/schema.sql` to it. Since that script selects `campus_resources` at the top, select the test database in MySQL Workbench and omit its initial `CREATE DATABASE` and `USE` statements when applying it. Set `MYSQL_TEST_DATABASE=campus_resources_test` plus `MYSQL_HOST`, `MYSQL_USER`, and `MYSQL_PASSWORD`. Never point this variable at a database containing data you need to keep. For the HTTP authorization check, start the app and set `TEST_APP_URL` and `TEST_STAFF_PASSWORD` in the shell before running:

   ```sh
   npm run test:integration
   ```

## Project structure

- `src/app` — Next.js UI and API route handlers
- `src/lib` — database connections, signed sessions, and allocation logic
- `database/schema.sql` — MySQL schema, view, triggers, and transfer procedure
- `database/mongodb.mongosh` — MongoDB collection validator and indexes
- `database/demo-queries.sql` — join/grouping/HAVING/subquery/index demonstrations
- `database/ddl_demo.sql` — CREATE/ALTER/DROP exercise on a scratch table
- `scripts/seed.mjs` — password-hashed sample users, resources, stock, and request
- `docs/design.md` — problem statement, ER diagram, relational schema, rationale, architecture, and test plan

The complete design, database rationale, MongoDB report flow, and test guidance are in [`docs/design.md`](./docs/design.md).
