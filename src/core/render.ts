import type { ClaimFinding, Receipt } from "./types.js";
import {
  bold,
  dim,
  gray,
  green,
  padEndVisible,
  padStartVisible,
  red,
  yellow,
} from "./ansi.js";
import { HOMEPAGE, NPM_PACKAGE, TOOL_NAME } from "../version.js";

const W = 46; // content width of the thermal receipt

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const s = ms / 1000;
  if (s < 100) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
}

function center(s: string): string {
  const pad = Math.max(0, Math.floor((W - s.length) / 2));
  return " ".repeat(pad) + s;
}

/** Pseudo-barcode derived from the content hash — a receipt needs a barcode. */
function barcode(hashHex: string | undefined): string {
  if (!hashHex) return "";
  const glyphs = ["▏", "▎", "▌", "█"];
  let out = "";
  for (let i = 0; i < Math.min(hashHex.length, 38); i++) {
    out += glyphs[parseInt(hashHex[i]!, 16) % glyphs.length];
  }
  return center(out);
}

const VERDICT_LABEL: Record<string, string> = {
  corroborated: "corroborated",
  contradicted: "CONTRADICTED",
  unverified: "unverified",
  "file-exists": "file exists",
  "file-missing": "FILE MISSING",
  info: "info",
};

function verdictStyled(verdict: string): string {
  const label = VERDICT_LABEL[verdict] ?? verdict;
  if (verdict === "contradicted" || verdict === "file-missing") return red(label);
  if (verdict === "corroborated" || verdict === "file-exists") return green(label);
  if (verdict === "unverified") return yellow(label);
  return dim(label);
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line === "") line = word;
    else if ((line + " " + word).length <= width) line += " " + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function renderReceiptTerminal(receipt: Receipt, savedPath?: string): string {
  const L: string[] = [];
  const rule = "═".repeat(W);
  const thin = dim("─".repeat(W));

  L.push("");
  L.push(rule);
  L.push(bold(center("R E C E I P T")));
  L.push(dim(center(`proof of work · ${TOOL_NAME} v${receipt.tool.version}`)));
  L.push(rule);

  const g = receipt.repo.git;
  const repoLine = g.headShort
    ? `${receipt.repo.root} @ ${g.headShort}${g.dirty ? ` (+${g.dirtyFiles} dirty)` : ""}`
    : receipt.repo.root;
  L.push(`${dim("repo")}   ${repoLine}`);
  if (g.branch) L.push(`${dim("branch")} ${g.branch}`);
  L.push(`${dim("date")}   ${receipt.createdAt.replace("T", " ").replace(/\.\d+Z/, " UTC")}`);
  L.push(`${dim("env")}    node ${receipt.env.node} · ${receipt.env.os} ${receipt.env.arch}`);
  L.push(thin);

  // Audit-only receipts (rcpt audit without --check) carry no fresh checks.
  if (receipt.checks.length > 0) {
    L.push(
      dim(padEndVisible("CHECK", 26) + padStartVisible("TIME", 9) + padStartVisible("RESULT", 11)),
    );
    for (const c of receipt.checks) {
      const name = c.name.length > 24 ? c.name.slice(0, 23) + "…" : c.name;
      const result = c.pass ? green("✓ PASS") : red(c.timedOut ? "✗ TIME" : "✗ FAIL");
      L.push(
        padEndVisible(name, 26) +
          padStartVisible(dim(fmtDuration(c.durationMs)), 9) +
          padStartVisible(result, 11),
      );
      if (!c.pass) {
        const code = c.timedOut ? "timed out" : `exit ${c.exitCode ?? "?"}`;
        L.push(dim(`  └ ${c.command}  (${code})`));
      }
    }
    L.push(thin);

    const s = receipt.summary;
    const total = `TOTAL  ${s.passed}/${s.total} PASSED`;
    const stamp = s.pass ? green(bold("✓ PAID IN FULL")) : red(bold("✗ INSUFFICIENT"));
    L.push(padEndVisible(bold(total), W - 16) + padStartVisible(stamp, 16));
  }

  if (receipt.audit) {
    if (receipt.checks.length > 0) L.push(thin);
    L.push(dim("CROSS-EXAMINATION" + ` (${receipt.audit.agent})`));
    if (receipt.audit.findings.length === 0) {
      L.push(dim("  no claims detected in final message"));
    }
    for (const f of receipt.audit.findings) {
      L.push(`  ${verdictStyled(f.verdict)}  ${f.claim.kind}${f.claim.file ? ` ${f.claim.file}` : ""}`);
      for (const line of wrapText(f.evidence, W - 5)) L.push(dim(`     ${line}`));
    }
    if (receipt.audit.skipMarkersAdded.length > 0) {
      L.push(yellow(`  ⚠ skip markers added in: ${receipt.audit.skipMarkersAdded.join(", ")}`));
    } else if (receipt.audit.testFileEdits.length > 0) {
      L.push(dim(`  note: session edited ${receipt.audit.testFileEdits.length} test file(s)`));
    }
  }

  L.push(thin);
  L.push(`${dim("id")}     ${receipt.id}`);
  if (receipt.integrity) {
    const sig = receipt.integrity.signature
      ? green("✓ signed ed25519")
      : yellow("unsigned (hash only)");
    L.push(`${dim("sha256")} ${receipt.integrity.contentSha256.slice(0, 24)}… ${sig}`);
    L.push(gray(barcode(receipt.integrity.contentSha256)));
  }
  if (savedPath) L.push(`${dim("saved")}  ${savedPath}`);
  L.push(rule);
  L.push(dim(center(`verify: npx ${NPM_PACKAGE} verify`)));
  L.push(dim(center("* THANK YOU FOR SHIPPING PROOF *")));
  L.push("");
  return L.join("\n");
}

export function renderSummaryLine(receipt: Receipt): string {
  const s = receipt.summary;
  const mark = s.pass ? green("✓") : red("✗");
  const names = receipt.checks
    .map((c) => `${c.name}:${c.pass ? green("pass") : red(c.timedOut ? "timeout" : "fail")}`)
    .join(" ");
  return `${mark} ${s.passed}/${s.total} checks passed · ${names} · ${receipt.id}`;
}

function findingRow(f: ClaimFinding): string {
  const icon =
    f.verdict === "contradicted" || f.verdict === "file-missing"
      ? "❌"
      : f.verdict === "corroborated" || f.verdict === "file-exists"
        ? "✅"
        : f.verdict === "unverified"
          ? "⚠️"
          : "ℹ️";
  const claimText = f.claim.text.replace(/\|/g, "\\|");
  const evidence = f.evidence.replace(/\|/g, "\\|");
  return `| ${icon} ${VERDICT_LABEL[f.verdict] ?? f.verdict} | ${f.claim.kind} | ${claimText} | ${evidence} |`;
}

/** Markdown receipt for PR comments and CI job summaries. */
export function renderReceiptMarkdown(receipt: Receipt): string {
  const s = receipt.summary;
  const head = s.pass
    ? `### 🧾 Receipt — ✅ ${s.passed}/${s.total} checks passed`
    : `### 🧾 Receipt — ❌ ${s.passed}/${s.total} checks passed`;
  const L: string[] = [head, ""];

  L.push("| check | result | time |");
  L.push("| --- | --- | --- |");
  for (const c of receipt.checks) {
    const result = c.pass ? "✅ pass" : c.timedOut ? "⏱️ timeout" : `❌ fail (exit ${c.exitCode ?? "?"})`;
    L.push(`| \`${c.name}\` | ${result} | ${fmtDuration(c.durationMs)} |`);
  }
  L.push("");

  const failed = receipt.checks.filter((c) => !c.pass);
  for (const c of failed) {
    L.push(`<details><summary>❌ <code>${c.name}</code> output tail</summary>`);
    L.push("");
    L.push("```");
    const tail = (c.stdoutTail + (c.stderrTail ? "\n--- stderr ---\n" + c.stderrTail : "")).trim();
    L.push(tail.slice(-2000) || "(no output)");
    L.push("```");
    L.push("");
    L.push("</details>");
    L.push("");
  }

  if (receipt.audit && receipt.audit.findings.length > 0) {
    L.push("#### Cross-examination of agent claims");
    L.push("");
    L.push("| verdict | kind | claim | evidence |");
    L.push("| --- | --- | --- | --- |");
    for (const f of receipt.audit.findings) L.push(findingRow(f));
    L.push("");
    if (receipt.audit.skipMarkersAdded.length > 0) {
      L.push(
        `> ⚠️ **Skip markers were added to test files during the session:** ${receipt.audit.skipMarkersAdded.map((p) => `\`${p}\``).join(", ")}`,
      );
      L.push("");
    }
  }

  const g = receipt.repo.git;
  const repoBits = [
    `\`${receipt.repo.root}${g.headShort ? ` @ ${g.headShort}` : ""}\``,
    g.dirty ? `${g.dirtyFiles} dirty file(s)` : "clean tree",
    `node ${receipt.env.node}`,
    receipt.integrity?.signature ? "signed ✓" : "unsigned",
  ];
  L.push(`<sub>${repoBits.join(" · ")} · receipt \`${receipt.id}\` · generated by [${TOOL_NAME}](${HOMEPAGE})</sub>`);
  return L.join("\n");
}
