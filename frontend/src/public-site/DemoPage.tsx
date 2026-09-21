import DemoLedger from "../public/DemoLedger";
import { Layers3 } from "lucide-react";
import "../public/public-site.css";
import "./site.css";
import "./demo-theme.css";

export default function DemoPage() {
  return (
    <div className="ledger-site" data-theme="light">
      <header className="ls-nav">
        <div className="ls-wrap ls-nav-inner">
          <a className="ls-brand" href="/">
            <span className="ls-logo">
              <Layers3 size={22} />
            </span>
            <span>
              <strong>Ledger.</strong>
              <small>留白工作室</small>
            </span>
          </a>
          <a
            className="ls-text-link"
            href="/#shortcuts"
            style={{ marginLeft: "auto" }}
          >
            安裝捷徑 →
          </a>
        </div>
      </header>
      <main className="ls-wrap ls-demo-full lb">
        <DemoLedger />
      </main>
    </div>
  );
}
