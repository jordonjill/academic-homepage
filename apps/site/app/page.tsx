import { loadSiteSnapshot } from "@academic-homepage/shared/local-data";

import { MatrixBackground } from "../components/matrix-background";
import { TerminalShell } from "../components/terminal-shell";

export default function HomePage() {
  const siteSnapshot = loadSiteSnapshot();

  return (
    <main className="relative h-[var(--app-height)] w-full overflow-hidden bg-[#031109] text-phosphor-100">
      <MatrixBackground />
      <div className="crt absolute inset-0 opacity-80" aria-hidden="true" />
      <div className="grid-pattern absolute inset-0" aria-hidden="true" />
      <div className="noise-overlay absolute inset-0" aria-hidden="true" />
      <div className="relative z-10 flex h-full min-h-0 w-full items-stretch justify-start p-0 md:items-center md:justify-center md:p-8">
        <TerminalShell snapshot={siteSnapshot} />
      </div>
    </main>
  );
}
