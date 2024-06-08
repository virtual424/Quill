"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "../_trpc/client";
import { Loader2 } from "lucide-react";

export default function Page() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const origin = searchParams.get("origin");

  const {
    data: response,
    isLoading,
    status,
    isSuccess,
    isError,
    error,
    isRefetchError,
  } = trpc.authCallback.useQuery(undefined, {
    retry: true,
    retryDelay: 500,
  });

  if (isError && error.data?.code === "UNAUTHORIZED") {
    console.log(error);
    router.push("/sign-in");
  }

  if (isSuccess && response.success) {
    console.log(response);
    router.push(origin ? `/${origin}` : "/dashboard");
  }

  return (
    <div className="w-full mt-24 flex justify-center">
      <div className="flex flex-col items-center gap-2">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-800" />
        <h3 className="font-semibold text-xl">Setting up your account...</h3>
        <p>You will be redirected automatically</p>
      </div>
    </div>
  );
}
