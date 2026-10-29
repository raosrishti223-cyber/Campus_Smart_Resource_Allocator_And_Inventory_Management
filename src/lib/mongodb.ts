import { MongoClient, type Collection, type Db } from "mongodb";

declare global {
  var campusMongoClientPromise: Promise<MongoClient> | undefined;
}

export type MaintenanceReportDocument = {
  resourceId: string;
  resourceName: string;
  departmentId: string | null;
  reportedBy: { userId: string; name: string };
  title: string;
  condition: "GOOD" | "FAIR" | "POOR" | "DAMAGED";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  notes: string;
  tags: string[];
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  statusUpdatedBy?: { userId: string; name: string };
  createdAt: Date;
  updatedAt: Date;
};

const MAINTENANCE_DATABASE_NAME = "campus_smart_resource_allocation";

async function getClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Missing required environment variable: MONGODB_URI");

  if (!globalThis.campusMongoClientPromise) {
    const client = new MongoClient(uri);
    globalThis.campusMongoClientPromise = client.connect().catch((error: unknown) => {
      globalThis.campusMongoClientPromise = undefined;
      throw error;
    });
  }

  return globalThis.campusMongoClientPromise;
}

export async function getMongoDatabase(): Promise<Db> {
  return (await getClient()).db(MAINTENANCE_DATABASE_NAME);
}

export async function getMaintenanceReportsCollection(): Promise<Collection<MaintenanceReportDocument>> {
  return (await getMongoDatabase()).collection<MaintenanceReportDocument>("maintenance_reports");
}