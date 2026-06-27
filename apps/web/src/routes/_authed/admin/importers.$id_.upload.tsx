import { createFileRoute } from "@tanstack/react-router";

// The wizard component (and its heavy children) lives in the matching
// `.lazy.tsx` file so it is code-split into its own chunk and only fetched when
// an operator actually opens the upload flow. See importers.$id_.upload.lazy.tsx.
export const Route = createFileRoute("/_authed/admin/importers/$id_/upload")({});
