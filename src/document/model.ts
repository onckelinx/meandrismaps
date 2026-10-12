/**
 * The Meandris Maps document model.
 *
 * Plain data only: no screen coordinates (except image placement, which is
 * user-authored), no rendering-library types. Every mutation goes through
 * `ops.ts` so the tree invariants stay intact.
 */

export type NodeId = string;
export type ImageId = string;
export type AssetId = string;

export type Side = "left" | "right";

export interface Boundary {
  /** Explicit fill colour; undefined means "derive from branch colour". */
  fill?: string;
  /** Explicit stroke colour; undefined means "derive from branch colour". */
  stroke?: string;
}

export interface MapNode {
  id: NodeId;
  text: string;
  /** null only for the root. */
  parentId: NodeId | null;
  /** Ordered child ids. */
  children: NodeId[];
  collapsed: boolean;
  /** Explicit branch colour. Undefined = inherit from the nearest ancestor. */
  color?: string;
  /** Boundary ("cloud") drawn around this node and its visible descendants. */
  boundary?: Boundary;
  /**
   * Which side of the root a top-level branch grows towards in the two-sided
   * layout. Only meaningful for direct children of the root.
   */
  side?: Side;
}

/**
 * An image placed on the map.
 *
 * - Free image (`nodeId` undefined): `x`/`y` is the top-left corner in map
 *   coordinates.
 * - Attached image: `x`/`y` is the top-left corner relative to the centre of
 *   the owning node's label, so the image follows the node through layout.
 */
export interface MapImage {
  id: ImageId;
  assetId: AssetId;
  nodeId?: NodeId;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Metadata for an embedded image file. The bytes live in the asset store. */
export interface AssetInfo {
  id: AssetId;
  mime: string;
  width: number;
  height: number;
}

export type LayoutMode = "both" | "right";

export interface MapSettings {
  layout: LayoutMode;
}

export interface MapMeta {
  created: string;
  modified: string;
}

export interface MapDocument {
  rootId: NodeId;
  nodes: Record<NodeId, MapNode>;
  /** Insertion order is the z-order (later = on top). */
  images: Record<ImageId, MapImage>;
  assets: Record<AssetId, AssetInfo>;
  settings: MapSettings;
  meta: MapMeta;
}
