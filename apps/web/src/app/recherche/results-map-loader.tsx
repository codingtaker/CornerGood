"use client";

import dynamic from "next/dynamic";

/** The map is the heaviest part of the page: loaded only in the browser. */
export const ResultsMapLoader = dynamic(
  () => import("./results-map").then((m) => m.ResultsMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-[60dvh] min-h-80 w-full animate-pulse rounded-md bg-foreground/5" />
    ),
  },
);
