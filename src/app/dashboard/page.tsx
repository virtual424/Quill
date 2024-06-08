import Dashboard from "@/components/Dashboard";
import { db } from "@/db";
import { getUserSubscriptionPlan } from "@/lib/stripe";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { redirect } from "next/navigation";

export default async function Page() {
  const { getUser } = getKindeServerSession();
  const user = await getUser();
  console.log(user);

  if (!user || !user.id) {
    redirect("/auth-callback?origin=dashboard");
  }

  const dbUser = await db.user.findFirst({
    where: {
      kid: user.id,
    },
  });

  if (!dbUser) redirect("/auth-callback?origin=dashboard");

  const plan = await getUserSubscriptionPlan();

  return <Dashboard subscriptionPlan={plan} />;
}
