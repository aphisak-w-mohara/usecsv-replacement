export type Env = {
  DB: D1Database;
  DEV_USER_EMAIL: string;
};

export type SessionContext = {
  user: { id: string; email: string; name: string };
  project_id: string;
  environment_id: string;
  role: "owner" | "member";
};

export type Variables = {
  session: SessionContext;
};
