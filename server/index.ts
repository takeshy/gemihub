import { serviceName } from "../shared/brand.ts";
import { origin } from "./auth.ts";
import { createApp } from "./app.ts";
if (process.env.NODE_ENV === "production") {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  if (!process.env.APP_ORIGIN?.startsWith("https://"))
    throw new Error("APP_ORIGIN must use HTTPS");
  if (process.env.DEMO_MODE === "true")
    throw new Error("DEMO_MODE must be disabled in production");
}
const port = Number(process.env.PORT || 3000);
const server = createApp();
server.listen(port, "0.0.0.0", () =>
  console.log(`${serviceName}: ${origin()} (port ${port})`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
