import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { MapDocument } from "../document/model";
import * as ops from "../document/ops";
import { FORMAT_VERSION, MapFileError, parseMap, serializeMap, type AssetBytes } from "./format";

function richDoc(): { doc: MapDocument; assets: Map<string, AssetBytes> } {
  const doc = ops.createDocument("Sports");
  const football = ops.addChild(doc, doc.rootId, { text: "Football" });
  const players = ops.addChild(doc, football, { text: "Players" });
  ops.addChild(doc, players, { text: "Goalkeepers" });
  ops.addChild(doc, doc.rootId, { text: "Basketball", side: "left" });
  ops.setColor(doc, football, "#3d7fd9");
  ops.setBoundary(doc, football, { fill: "#eef4ff" });
  ops.setCollapsed(doc, players, true);
  ops.addAsset(doc, { id: "a_1", mime: "image/png", width: 4, height: 2 });
  ops.addImage(doc, { id: "i_free", assetId: "a_1", x: 100, y: -50, width: 40, height: 20 });
  ops.addImage(doc, { id: "i_att", assetId: "a_1", nodeId: football, x: -20, y: -60, width: 40, height: 20 });
  const assets = new Map([["a_1", { bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]), mime: "image/png" }]]);
  return { doc, assets };
}

function rezip(bytes: Uint8Array, mutate: (json: Record<string, unknown>) => void): Uint8Array {
  const entries = unzipSync(bytes);
  const json = JSON.parse(strFromU8(entries["map.json"]));
  mutate(json);
  entries["map.json"] = strToU8(JSON.stringify(json));
  return zipSync(entries);
}

describe("native file format", () => {
  it("round-trips all document state (scenario I)", () => {
    const { doc, assets } = richDoc();
    const bytes = serializeMap(doc, (id) => assets.get(id));
    const parsed = parseMap(bytes);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.doc.nodes).toEqual(doc.nodes);
    expect(parsed.doc.images).toEqual(doc.images);
    expect(parsed.doc.assets).toEqual(doc.assets);
    expect(parsed.doc.settings).toEqual(doc.settings);
    expect(parsed.doc.rootId).toBe(doc.rootId);
    expect(parsed.assets.get("a_1")!.bytes).toEqual(assets.get("a_1")!.bytes);
  });

  it("writes a versioned, readable container", () => {
    const { doc, assets } = richDoc();
    const entries = unzipSync(serializeMap(doc, (id) => assets.get(id)));
    expect(strFromU8(entries.mimetype)).toBe("application/x-meandris-map");
    const json = JSON.parse(strFromU8(entries["map.json"]));
    expect(json.format).toBe("meandris-map");
    expect(json.version).toBe(FORMAT_VERSION);
    expect(Object.keys(entries)).toContain("assets/a_1.png");
  });

  it("does not store unused assets", () => {
    const { doc, assets } = richDoc();
    ops.deleteImage(doc, "i_free");
    ops.deleteImage(doc, "i_att");
    const entries = unzipSync(serializeMap(doc, (id) => assets.get(id)));
    expect(Object.keys(entries).some((k) => k.startsWith("assets/"))).toBe(false);
  });

  it("rejects files that are not maps", () => {
    expect(() => parseMap(strToU8("hello"))).toThrow(MapFileError);
    expect(() => parseMap(zipSync({ "other.txt": strToU8("x") }))).toThrow(/not a Meandris Maps document/);
    expect(() => parseMap(zipSync({ "map.json": strToU8("{oops") }))).toThrow(/damaged/);
  });

  it("explains files from a newer version", () => {
    const { doc, assets } = richDoc();
    const bytes = rezip(serializeMap(doc, (id) => assets.get(id)), (j) => (j.version = 99));
    expect(() => parseMap(bytes)).toThrow(/newer version/);
  });

  it("keeps the map when an embedded image is missing", () => {
    const { doc } = richDoc();
    const parsed = parseMap(serializeMap(doc, () => undefined));
    expect(Object.keys(parsed.doc.images)).toHaveLength(2);
    expect(parsed.assets.size).toBe(0);
    expect(parsed.warnings.join(" ")).toMatch(/placeholders/);
  });

  it("repairs broken links and re-attaches detached topics", () => {
    const { doc, assets } = richDoc();
    const bytes = rezip(serializeMap(doc, (id) => assets.get(id)), (j) => {
      const nodes = j.nodes as { id: string; children: string[] }[];
      const root = nodes[0];
      const detached = root.children.shift()!; // Football no longer listed under the root
      root.children.push("n_missing");
      void detached;
    });
    const parsed = parseMap(bytes);
    expect(ops.checkInvariants(parsed.doc)).toEqual([]);
    const texts = parsed.doc.nodes[parsed.doc.rootId].children.map((c) => parsed.doc.nodes[c].text);
    expect(texts).toContain("Football");
    expect(Object.keys(parsed.doc.nodes)).toHaveLength(Object.keys(doc.nodes).length);
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  it("ignores invalid colours instead of failing", () => {
    const { doc, assets } = richDoc();
    const bytes = rezip(serializeMap(doc, (id) => assets.get(id)), (j) => {
      (j.nodes as { color?: string }[])[1].color = "url(javascript:alert(1))";
    });
    const parsed = parseMap(bytes);
    expect(Object.values(parsed.doc.nodes).some((n) => n.color?.startsWith("url"))).toBe(false);
  });

  it("carries extra files (recovery metadata)", () => {
    const { doc, assets } = richDoc();
    const bytes = serializeMap(doc, (id) => assets.get(id), { extraFiles: { "recovery.json": strToU8("{}") } });
    expect(Object.keys(parseMap(bytes).extraFiles)).toEqual(["recovery.json"]);
  });
});
