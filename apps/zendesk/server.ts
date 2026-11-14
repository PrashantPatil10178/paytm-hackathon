import { serveApp } from "@ph/shared/server";
import html from "./src/index.html";

serveApp({ name: "Zendesk (Demo)", port: 3001, html });
