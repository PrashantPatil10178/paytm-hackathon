import { serveApp } from "@ph/shared/server";
import html from "./src/index.html";

serveApp({ name: "HubSpot CRM (Demo)", port: 3002, html });
