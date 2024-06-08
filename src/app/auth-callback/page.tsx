"use client";

import { Suspense } from "react";
import AuthCallback from "./Authcallback";

export default function Page() {
  return (
    <Suspense>
      <AuthCallback />
    </Suspense>
  );
}
