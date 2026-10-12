/**
 * Pure SVG drawing of a laid-out map. No event handlers: the interactive
 * canvas hit-tests against the layout instead, and the same component is
 * rendered to a string for SVG/PNG export and printing.
 */
import { memo } from "react";
import { inAnchor, outAnchor, type MapLayout, type NodeLayout, type Point } from "../layout/layout";
import { branchStartWidth, FONT_FAMILY } from "../layout/styles";
import { branchPath, underlinePath } from "./branches";
import type { MapTheme } from "./theme";

export interface SceneProps {
  layout: MapLayout;
  theme: MapTheme;
  /** Resolves an asset id to an image URL (object URL on screen, data URL in exports). */
  imageUrl: (assetId: string, displayWidth: number) => string | undefined;
  /** Node whose text is hidden because the inline editor is drawn over it. */
  editingId?: string | null;
  /** Topics drawn faded (e.g. the branch being dragged). */
  dimmed?: Set<string>;
  /** Image drawn elsewhere (e.g. as a live preview while it is moved). */
  hiddenImage?: string | null;
}

/** Baseline of the first line, from the top of the text block, matching CSS line boxes for Inter. */
export function baselineOffset(fontSize: number, lineHeight: number): number {
  return ((lineHeight - 1.21) / 2 + 0.969) * fontSize;
}

export function MapScene({ layout, theme, imageUrl, editingId, dimmed, hiddenImage }: SceneProps) {
  const nodes = layout.order.map((id) => layout.nodes.get(id)!);
  return (
    <g className="map-scene">
      <g className="boundaries">
        {layout.boundaries.map((b) => (
          <path
            key={b.nodeId}
            d={b.path}
            fill={b.fill ?? b.color}
            fillOpacity={theme.boundaryFillOpacity}
            stroke={b.stroke ?? b.color}
            strokeOpacity={theme.boundaryStrokeOpacity}
            strokeWidth={1.5}
          />
        ))}
      </g>
      <g className="images">
        {layout.images.map(({ id, image, rect }) => {
          if (id === hiddenImage) return null;
          const href = imageUrl(image.assetId, rect.width);
          return href ? (
            <image
              key={id}
              href={href}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              preserveAspectRatio="none"
            />
          ) : (
            <g key={id}>
              <rect
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                fill="none"
                stroke={theme.mutedText}
                strokeDasharray="4 4"
              />
              <text
                x={rect.x + rect.width / 2}
                y={rect.y + rect.height / 2}
                textAnchor="middle"
                fontFamily={FONT_FAMILY}
                fontSize={12}
                fill={theme.mutedText}
              >
                Image unavailable
              </text>
            </g>
          );
        })}
      </g>
      <g className="branches">
        {nodes.map((n) => {
          if (!n.parentId) return null;
          return <Branch key={n.id} node={n} parent={layout.nodes.get(n.parentId)!} dim={!!dimmed?.has(n.id)} />;
        })}
      </g>
      <g className="nodes">
        {nodes.map((n) => (
          <NodeLabel key={n.id} node={n} theme={theme} hideText={n.id === editingId} dim={!!dimmed?.has(n.id)} />
        ))}
      </g>
    </g>
  );
}

/** Root branches fan out from the edge of the central bubble rather than its centre. */
function branchStart(parent: NodeLayout, to: Point): Point {
  if (parent.side !== "root") return outAnchor(parent);
  const cx = parent.x + parent.width / 2;
  const cy = parent.y + parent.height / 2;
  const dir = to.x >= cx ? 1 : -1;
  const r = Math.min(parent.height / 2, 22);
  const maxDy = Math.max(0, parent.height / 2 - 10);
  const dy = Math.max(-maxDy, Math.min(maxDy, (to.y - cy) * 0.22));
  const cornerDy = Math.max(0, Math.abs(dy) - (parent.height / 2 - r));
  const edge = parent.width / 2 - r + Math.sqrt(Math.max(0, r * r - cornerDy * cornerDy));
  return { x: cx + dir * (edge - 6), y: cy + dy };
}

const Branch = memo(function Branch({ node, parent, dim }: { node: NodeLayout; parent: NodeLayout; dim: boolean }) {
  const to = inAnchor(node);
  const from = branchStart(parent, to);
  return (
    <path
      d={branchPath({
        from,
        to,
        startWidth: branchStartWidth(parent.depth),
        endWidth: node.style.lineWidth,
      })}
      fill={node.color}
      opacity={dim ? 0.25 : undefined}
    />
  );
});

const NodeLabel = memo(function NodeLabel({
  node,
  theme,
  hideText,
  dim,
}: {
  node: NodeLayout;
  theme: MapTheme;
  hideText: boolean;
  dim: boolean;
}) {
  const { style } = node;
  const isRoot = style.shape === "bubble";
  const lh = style.fontSize * style.lineHeight;
  const base = node.y + style.padTop + baselineOffset(style.fontSize, style.lineHeight);
  let textX: number;
  let anchor: "start" | "middle" | "end";
  if (isRoot) {
    textX = node.x + node.width / 2;
    anchor = "middle";
  } else if (node.side === "left") {
    textX = node.x + node.width - style.padX;
    anchor = "end";
  } else {
    textX = node.x + style.padX;
    anchor = "start";
  }
  const start = inAnchor(node);
  const end = outAnchor(node);
  const badgeDir = node.side === "left" ? -1 : 1;
  return (
    <g opacity={dim ? 0.25 : undefined}>
      {isRoot ? (
        <rect
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          rx={Math.min(node.height / 2, 22)}
          fill={theme.rootFill}
          stroke={theme.rootStroke}
          strokeWidth={2.5}
        />
      ) : (
        <path d={underlinePath(start, end, style.lineWidth)} fill={node.color} />
      )}
      {!hideText && (
        <text
          fontFamily={FONT_FAMILY}
          fontSize={style.fontSize}
          fontWeight={style.fontWeight}
          fill={isRoot ? theme.rootText : theme.text}
          textAnchor={anchor}
        >
          {node.lines.map((line, i) => (
            <tspan key={i} x={textX} y={base + i * lh}>
              {line || "​"}
            </tspan>
          ))}
        </text>
      )}
      {node.collapsed && node.hiddenCount > 0 && (
        <g>
          <circle
            cx={(isRoot ? node.x + node.width : end.x) + badgeDir * 12}
            cy={isRoot ? node.y + node.height / 2 : end.y}
            r={10}
            fill={theme.badgeFill}
            stroke={node.color}
            strokeWidth={1.8}
          />
          <text
            x={(isRoot ? node.x + node.width : end.x) + badgeDir * 12}
            y={(isRoot ? node.y + node.height / 2 : end.y) + 3.6}
            textAnchor="middle"
            fontFamily={FONT_FAMILY}
            fontSize={node.hiddenCount > 99 ? 8 : 10}
            fontWeight={600}
            fill={theme.text}
          >
            {node.hiddenCount > 99 ? "99+" : node.hiddenCount}
          </text>
        </g>
      )}
    </g>
  );
});
