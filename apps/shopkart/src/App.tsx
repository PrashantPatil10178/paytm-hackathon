import { useLocation } from "@ph/shared/react";
import { Header } from "./components/Header.tsx";
import { ChatWidget } from "./components/Chat.tsx";
import { Footer } from "./components/Footer.tsx";
import { Home } from "./pages/Home.tsx";
import { Orders } from "./pages/Orders.tsx";
import { Help } from "./pages/Help.tsx";
import { Business } from "./pages/Business.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { ShopProvider } from "./store.tsx";

const PAGES: Record<string, () => React.ReactNode> = {
  "/": Home,
  "/orders": Orders,
  "/help": Help,
  "/business": Business,
};

export function App() {
  const { path } = useLocation();
  const Page = PAGES[path] ?? NotFound;
  return (
    <ShopProvider>
      <div className="flex min-h-dvh flex-col">
        <Header path={path} />
        <main className="flex-1">
          <Page />
        </main>
        <Footer />
      </div>
      <ChatWidget />
    </ShopProvider>
  );
}
