import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";
const PublicSite = lazy(() =>
  import("./public-site/PublicSite").then((m) => ({ default: m.PublicSite })),
);
const DemoPage = lazy(() => import("./public-site/DemoPage"));
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { App } from "./App";
import "./styles.css";
import "./public-site/app-theme.css";

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(
    import.meta.env.VITE_PUBLIC_DOCS === "1" ? (
      <Suspense fallback={<p style={{ padding: 32 }}>載入 Ledger…</p>}>
        {window.location.pathname.replace(/\/$/, "") === "/demo" ? (
          <DemoPage />
        ) : (
          <PublicSite />
        )}
      </Suspense>
    ) : (
      <BrowserRouter
        basename={(import.meta.env.VITE_BASE_PATH as string | undefined) || "/"}
      >
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/dashboard" element={<App />} />
          <Route path="/ledger" element={<App />} />
          <Route path="/budget" element={<App />} />
          <Route path="/capture" element={<App />} />
          <Route path="/map" element={<App />} />
          <Route path="/settings" element={<App />} />
          <Route path="/setup" element={<App />} />
          <Route path="/assistant" element={<App />} />
          <Route path="/reflect" element={<App />} />
          <Route
            path="*"
            element={
              <div
                style={{
                  padding: "2rem",
                  fontFamily: "sans-serif",
                  textAlign: "center",
                }}
              >
                404 — Not Found
              </div>
            }
          />
        </Routes>
      </BrowserRouter>
    ),
  );
} else {
  console.error("No #root element found");
}
