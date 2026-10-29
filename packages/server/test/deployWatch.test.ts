import { describe, expect, it } from "vitest";
import { launchAgentPlist, parseWatchArgs, LABEL } from "../../../scripts/deploy-watch.mjs";

describe("automatic main deployment schedule", () => {
  it("checks once per minute and uses the same explicit private config for every run", () => {
    const plist = launchAgentPlist({ node: "/opt/homebrew/bin/node", runtime: "/Users/test/.rougehalla/deployer",
      config: "/Users/test/.rougehalla/deploy-config.json", stateDir: "/Users/test/.rougehalla", interval: 60 });
    expect(plist).toContain(`<string>${LABEL}</string>`);
    expect(plist).toContain("<key>StartInterval</key><integer>60</integer>");
    expect(plist).toContain("<key>RunAtLoad</key><true/>");
    expect(plist).toContain("<string>once</string><string>--config</string>");
    expect(plist).toContain("<string>/Users/test/.rougehalla/deploy-config.json</string>");
    expect(plist).not.toContain("PLAYTEST_PASSCODE");
    expect(plist).not.toContain("/bin/sh");
    expect(plist).not.toContain("KeepAlive");
  });

  it("quotes paths as plist values so spaces and XML characters cannot change its command", () => {
    const plist = launchAgentPlist({ node: "/Applications/Node & Tools/node", runtime: "/Users/Test User/deployer",
      config: '/Users/Test User/config <"live">.json', stateDir: "/Users/Test User/.rougehalla", interval: 90 });
    expect(plist).toContain("<string>/Applications/Node &amp; Tools/node</string>");
    expect(plist).toContain("<string>/Users/Test User/deployer/deploy-watch.mjs</string>");
    expect(plist).toContain("config &lt;&quot;live&quot;&gt;.json</string>");
    expect(plist).toContain("<integer>90</integer>");
  });

  it("rejects ambiguous commands, missing values and overly aggressive polling", () => {
    expect(parseWatchArgs(["install"]).interval).toBe(60);
    expect(parseWatchArgs(["once", "--config", "/tmp/deploy.json"]).config).toBe("/tmp/deploy.json");
    expect(parseWatchArgs(["uninstall"]).command).toBe("uninstall");
    for (const args of [["install", "once"], ["--config"], ["--interval"], ["--interval", "0"],
      ["--interval", "29"], ["--interval", "99999"], ["--interval", "0.5"], ["--interval", "fast"]]) {
      expect(() => parseWatchArgs(args)).toThrow();
    }
  });
});
