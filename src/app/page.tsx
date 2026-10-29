import { Dashboard } from "@/app/components/Dashboard";
import { LoginForm } from "@/app/components/LoginForm";
import { getSession } from "@/lib/auth";

export default async function Home() {
  const user = await getSession();
  return user ? <Dashboard user={user} /> : <LoginForm />;
}
