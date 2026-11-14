import { join } from "node:path";
import { serveApp } from "@ph/shared/server";
import html from "./src/index.html";

serveApp({ name: "ShopKart", port: 3003, html, publicDir: join(import.meta.dir, "public") });
