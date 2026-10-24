import { describe, expect, it } from "vitest";
import { planTree, TreePlanError } from "@/lib/tree";

describe("planTree", () => {
  it("strips a single wrapping folder and keeps the index at the root", () => {
    const plan = planTree([
      { path: "demo-site/index.html", size: 10 },
      { path: "demo-site/assets/app.css", size: 5 },
    ]);
    expect(plan.rootPrefix).toBe("demo-site/");
    expect(plan.entryPath).toBe("index.html");
    expect(plan.kind).toBe("folder");
    expect(plan.fileCount).toBe(2);
    expect(plan.totalBytes).toBe(15);
  });

  it("does not strip when the index already sits at the root", () => {
    const plan = planTree([
      { path: "index.html", size: 10 },
      { path: "img/logo.png", size: 5 },
    ]);
    expect(plan.rootPrefix).toBe("");
    expect(plan.entryPath).toBe("index.html");
  });

  it("treats one HTML file as a single page", () => {
    const plan = planTree([{ path: "report.html", size: 12 }]);
    expect(plan.kind).toBe("single");
    expect(plan.entryPath).toBe("report.html");
  });

  it("treats one PDF as a document", () => {
    const plan = planTree([{ path: "contract.pdf", size: 12 }]);
    expect(plan.kind).toBe("document");
    expect(plan.entryPath).toBe("contract.pdf");
  });

  it("ignores __MACOSX and .DS_Store", () => {
    const plan = planTree([
      { path: "site/index.html", size: 10 },
      { path: "__MACOSX/site/._index.html", size: 3 },
      { path: "site/.DS_Store", size: 3 },
    ]);
    expect(plan.fileCount).toBe(1);
  });

  it("flags an app that needs a build step", () => {
    const plan = planTree(
      [
        { path: "app/index.html", size: 10 },
        { path: "app/package.json", size: 100 },
      ],
      { packageJson: JSON.stringify({ scripts: { dev: "vite", build: "vite build" } }) },
    );
    expect(plan.needsRuntime).toBe(true);
    expect(plan.runtimeReason).toBe("build-required");
  });

  it("flags a server app by its markers", () => {
    const plan = planTree([
      { path: "index.html", size: 10 },
      { path: "server.js", size: 40 },
    ]);
    expect(plan.needsRuntime).toBe(true);
    expect(plan.runtimeReason).toBe("server-app");
  });

  it("says an app without a static entry needs a runtime instead of 'no entry'", () => {
    const error = (() => {
      try {
        planTree([
          { path: "server.js", size: 10 },
          { path: "package.json", size: 10 },
        ]);
      } catch (cause) {
        return cause;
      }
    })();
    expect(error).toBeInstanceOf(TreePlanError);
    expect((error as TreePlanError).code).toBe("needs-runtime");
  });

  it("rejects a tree with no entry point at all", () => {
    expect(() => planTree([{ path: "notes.txt", size: 3 }, { path: "data.csv", size: 3 }])).toThrow(TreePlanError);
  });

  it("rejects unsafe paths", () => {
    expect(() => planTree([{ path: "../escape.html", size: 1 }])).toThrow();
    expect(() => planTree([{ path: "/etc/passwd", size: 1 }])).toThrow();
    expect(() => planTree([{ path: "a/node_modules/x.js", size: 1 }])).toThrow();
  });
});
