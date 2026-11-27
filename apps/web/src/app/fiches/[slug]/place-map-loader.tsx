"use client";

import dynamic from "next/dynamic";

/** The map is the heaviest part of the page: loaded only in the browser. */
export const PlaceMapLoader = dynamic(
  () => import("./place-map").then((m) => m.PlaceMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 w-full animate-pulse rounded-md bg-foreground/5" />
    ),
  },
);
