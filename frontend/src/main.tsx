import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { App } from "./App";
import { PublicSite } from "./public-site/PublicSite";
import "./styles.css";
import "./public-site/app-theme.css";

const container = document.getElementById("root");
if (container) {
   const root = createRoot(container);
   root.render(
     import.meta.env.VITE_PUBLIC_DOCS === "1" ? <PublicSite /> : <BrowserRouter basename={(import.meta.env.VITE_BASE_PATH as string | undefined) || "/"}>
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
     );
   }
   else {
     console.error("No #root element found");
     }