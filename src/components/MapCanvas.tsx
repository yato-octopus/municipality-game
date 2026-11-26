import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getPrefMutedFill } from '../data/prefColors';
import type { ViewBoxRect } from '../hooks/useMapViewport';
import type { InsetBoxSpec } from '../services/mapDataLoader';
import type {
  ConfigState,
  GeographyFeature,
  HintAreaOverlay,
  MapPieceItem,
  MapTag,
  UiTheme,
} from '../types/game';

interface SafariGestureEvent extends Event {
  scale: number;
  clientX: number;
  clientY: number;
}

interface MapCanvasProps {
  svgRef: React.RefCallback<SVGSVGElement>;
  viewBox: ViewBoxRect;
  viewBoxString: string;
  targetPieces: MapPieceItem[];
  /** Full geographic pool for the active mode so subset/review puzzles don't spoil target holes */
  poolPieces?: MapPieceItem[];
  contextPieces: MapPieceItem[];
  bgPrefPieces: MapPieceItem[];
  insets: InsetBoxSpec[];
  completedIds: Set<string>;
  /** Optional IDs missed during the session (highlighted distinctly during post-game inspection) */
  missedIds?: Set<string>;
  activePieceId: string | null;
  hintPieceId: string | null;
  selectedPieceId: string | null;
  config: ConfigState;
  tags: MapTag[];
  /** Override showing all piece names (e.g. ViewMode) */
  forceShowNames?: boolean;
  /** ViewMode capital pin display */
  showCapitalMarks?: boolean;
  /** ViewMode swap label from prefecture to capital */
  swapCapitalLabel?: boolean;
  /** Optional custom highlight IDs (e.g. ViewMode selection or Puzzle snap preview) */
  hoverTargetId?: string | null;
  isTerrainMode?: boolean;
  enablePrefHoverTooltip?: boolean;
  enablePrefTint?: boolean;
  hintArea?: HintAreaOverlay | null;
  hintFittedPieceId?: string | null;
  onPieceClick?: (piece: MapPieceItem) => void;
  onPanBy: (dx: number, dy: number) => void;
  onFinishPan: (vx: number, vy: number) => void;
  onZoomByFactor: (factor: number, clientX?: number, clientY?: number) => void;
}

interface MapThemePalette {
  oceanSilhouette: string;
  oceanHypsometric: string;
  hypsometric: readonly string[];
  piece: {
    silhouetteLand: string;
    contextSilhouette: string;
    contextHypsometric: string;
    borderNormal: string;
    borderContext: string;
    completedCleanSilhouetteFill: string;
    completedCleanSilhouetteStroke: string;
    completedCleanHypsoFill: string;
    completedCleanHypsoStroke: string;
    completedMissedSilhouetteFill: string;
    completedMissedHypsoFill: string;
    completedMissedStroke: string;
    hoverFill: string;
    hoverStroke: string;
    selectedFill: string;
    selectedStroke: string;
    activeFill: string;
    activeStroke: string;
    hintFill: string;
    hintStroke: string;
    hintFittedFill: string;
    hintFittedStroke: string;
    elevatedHaloStroke: string;
  };
  bgPref: {
    terrainLand: string;
    silhouetteLand: string;
    hypsoLand: string;
    borderNormal: string;
    borderTinted: string;
  };
  prefBorderOverlayStroke: string;
  insetFrameStroke: string;
  insetRx: number;
  insetCaptionFill: string;
  terrain: {
    mountain: {
      defaultFill: string;
      defaultStroke: string;
      activeFill: string;
      activeStroke: string;
      hintFill: string;
      hintStroke: string;
      selectedFill: string;
      selectedStroke: string;
      completedFill: string;
      completedStroke: string;
      missedFill: string;
      missedStroke: string;
      hintFittedFill: string;
      hintFittedStroke: string;
      pulseRingHint: string;
      pulseRingActive: string;
    };
    plain: {
      defaultFill: string;
      defaultStroke: string;
      activeFill: string;
      activeStroke: string;
      selectedFill: string;
      selectedStroke: string;
      missedFill: string;
      missedStroke: string;
      completedFill: string;
      completedStroke: string;
      hintFill: string;
      hintStroke: string;
      hintFittedFill: string;
      hintFittedStroke: string;
    };
    lake: {
      defaultFill: string;
      defaultStroke: string;
      completedFill: string;
      completedStroke: string;
      activeFill: string;
      activeStroke: string;
      selectedFill: string;
      selectedStroke: string;
      missedFill: string;
      missedStroke: string;
      hintFill: string;
      hintStroke: string;
      hintFittedFill: string;
      hintFittedStroke: string;
      smallRingHint: string;
      smallRingActive: string;
    };
    river: {
      defaultStroke: string;
      completedStroke: string;
      selectedStroke: string;
      activeStroke: string;
      hintStroke: string;
      missedStroke: string;
      hintFittedStroke: string;
    };
    mountains: {
      zoneDefaultFill: string;
      zoneDefaultStroke: string;
      zoneCompletedStroke: string;
      zoneActiveStroke: string;
      zoneHintStroke: string;
      zoneSelectedFill: string;
      zoneSelectedStroke: string;
      zoneMissedFill: string;
      zoneMissedStroke: string;
      zoneHintFittedFill: string;
      zoneHintFittedStroke: string;
      ridgeDefaultStroke: string;
      ridgeActiveStroke: string;
      ridgeHintStroke: string;
      ridgeSelectedStroke: string;
      ridgeMissedStroke: string;
      ridgeHintFittedStroke: string;
    };
  };
  hint1Fill: string;
  hint1Stroke: string;
  hint1LabelFill: string;
  hint2PulseFill: string;
  hint2PulseStroke: string;
  nonTerrainPulseHint: string;
  nonTerrainPulseActive: string;
  capitalPinStroke: string;
  capitalPinFill: string;
  tagDotFill: string;
  labelDefaultFill: string;
  labelSelectedFill: string;
  labelHintFittedFill: string;
}

const MAP_PALETTES: Record<UiTheme, MapThemePalette> = {
  classic: {
    oceanSilhouette: '#dcebfa',
    oceanHypsometric: '#cfe5f7',
    hypsometric: [
      '#a7d996',
      '#bfe19b',
      '#d7e69d',
      '#ebe098',
      '#f0cc7f',
      '#e7b16a',
      '#d7935b',
      '#c47a4d',
    ],
    piece: {
      silhouetteLand: '#fbfaf6',
      contextSilhouette: '#e5e7eb',
      contextHypsometric: '#d5dbe2',
      borderNormal: '#475569',
      borderContext: '#94a3b8',
      completedCleanSilhouetteFill: '#bbf7d0',
      completedCleanSilhouetteStroke: '#0f766e',
      completedCleanHypsoFill: '#10b981',
      completedCleanHypsoStroke: '#065f46',
      completedMissedSilhouetteFill: '#fde68a',
      completedMissedHypsoFill: '#fbbf24',
      completedMissedStroke: '#b45309',
      hoverFill: '#fde68a',
      hoverStroke: '#d97706',
      selectedFill: '#bae6fd',
      selectedStroke: '#0284c7',
      activeFill: '#fed7aa',
      activeStroke: '#ea580c',
      hintFill: '#fca5a5',
      hintStroke: '#dc2626',
      hintFittedFill: '#86efac',
      hintFittedStroke: '#059669',
      elevatedHaloStroke: '#ffffff',
    },
    bgPref: {
      terrainLand: '#f8f7f2',
      silhouetteLand: '#ecebe4',
      hypsoLand: '#dfe4d5',
      borderNormal: '#94a3b8',
      borderTinted: '#475569',
    },
    prefBorderOverlayStroke: '#334155',
    insetFrameStroke: '#475569',
    insetRx: 1.5,
    insetCaptionFill: '#475569',
    terrain: {
      mountain: {
        defaultFill: '#b45309',
        defaultStroke: '#78350f',
        activeFill: '#ea580c',
        activeStroke: '#9a3412',
        hintFill: '#dc2626',
        hintStroke: '#7f1d1d',
        selectedFill: '#0284c7',
        selectedStroke: '#0c4a6e',
        completedFill: '#15803d',
        completedStroke: '#14532d',
        missedFill: '#d97706',
        missedStroke: '#92400e',
        hintFittedFill: '#10b981',
        hintFittedStroke: '#059669',
        pulseRingHint: '#dc2626',
        pulseRingActive: '#ea580c',
      },
      plain: {
        defaultFill: '#65a30d',
        defaultStroke: '#4d7c0f',
        activeFill: '#84cc16',
        activeStroke: '#ea580c',
        selectedFill: '#38bdf8',
        selectedStroke: '#0284c7',
        missedFill: '#f59e0b',
        missedStroke: '#b45309',
        completedFill: '#22c55e',
        completedStroke: '#15803d',
        hintFill: '#f97316',
        hintStroke: '#dc2626',
        hintFittedFill: '#10b981',
        hintFittedStroke: '#059669',
      },
      lake: {
        defaultFill: '#0284c7',
        defaultStroke: '#0369a1',
        completedFill: '#0284c7',
        completedStroke: '#0c4a6e',
        activeFill: '#0ea5e9',
        activeStroke: '#ea580c',
        selectedFill: '#38bdf8',
        selectedStroke: '#0369a1',
        missedFill: '#f59e0b',
        missedStroke: '#b45309',
        hintFill: '#38bdf8',
        hintStroke: '#dc2626',
        hintFittedFill: '#10b981',
        hintFittedStroke: '#059669',
        smallRingHint: '#dc2626',
        smallRingActive: '#ea580c',
      },
      river: {
        defaultStroke: '#2563eb',
        completedStroke: '#1d4ed8',
        selectedStroke: '#0284c7',
        activeStroke: '#ea580c',
        hintStroke: '#dc2626',
        missedStroke: '#d97706',
        hintFittedStroke: '#059669',
      },
      mountains: {
        zoneDefaultFill: '#9a3412',
        zoneDefaultStroke: '#9a3412',
        zoneCompletedStroke: '#7c2d12',
        zoneActiveStroke: '#ea580c',
        zoneHintStroke: '#dc2626',
        zoneSelectedFill: '#0284c7',
        zoneSelectedStroke: '#0284c7',
        zoneMissedFill: '#d97706',
        zoneMissedStroke: '#b45309',
        zoneHintFittedFill: '#10b981',
        zoneHintFittedStroke: '#059669',
        ridgeDefaultStroke: '#7c2d12',
        ridgeActiveStroke: '#ea580c',
        ridgeHintStroke: '#dc2626',
        ridgeSelectedStroke: '#0284c7',
        ridgeMissedStroke: '#b45309',
        ridgeHintFittedStroke: '#059669',
      },
    },
    hint1Fill: 'rgba(245, 158, 11, 0.16)',
    hint1Stroke: '#d97706',
    hint1LabelFill: '#b45309',
    hint2PulseFill: 'rgba(16, 185, 129, 0.14)',
    hint2PulseStroke: '#059669',
    nonTerrainPulseHint: '#dc2626',
    nonTerrainPulseActive: '#ea580c',
    capitalPinStroke: '#dc2626',
    capitalPinFill: '#dc2626',
    tagDotFill: '#7c3aed',
    labelDefaultFill: '#0f172a',
    labelSelectedFill: '#0369a1',
    labelHintFittedFill: '#065f46',
  },
  google: {
    oceanSilhouette: '#c8e4fd',
    oceanHypsometric: '#bddbf7',
    hypsometric: [
      '#e6f4ea',
      '#ceead6',
      '#d7ecc8',
      '#f2ebd3',
      '#fce8b2',
      '#fad2a4',
      '#f3bf96',
      '#e2a882',
    ],
    piece: {
      silhouetteLand: '#ffffff',
      contextSilhouette: '#eceff1',
      contextHypsometric: '#e0e4e8',
      borderNormal: '#80868b',
      borderContext: '#bdc1c6',
      completedCleanSilhouetteFill: '#ceead6',
      completedCleanSilhouetteStroke: '#137333',
      completedCleanHypsoFill: '#1e8e3e',
      completedCleanHypsoStroke: '#0d652d',
      completedMissedSilhouetteFill: '#feefc3',
      completedMissedHypsoFill: '#f9ab00',
      completedMissedStroke: '#b06000',
      hoverFill: '#d2e3fc',
      hoverStroke: '#1a73e8',
      selectedFill: '#d2e3fc',
      selectedStroke: '#1a73e8',
      activeFill: '#fce8e6',
      activeStroke: '#ea4335',
      hintFill: '#f9d2ce',
      hintStroke: '#d93025',
      hintFittedFill: '#a8dab5',
      hintFittedStroke: '#1e8e3e',
      elevatedHaloStroke: '#ffffff',
    },
    bgPref: {
      terrainLand: '#f8f9fa',
      silhouetteLand: '#eff1f3',
      hypsoLand: '#e8ece6',
      borderNormal: '#bdc1c6',
      borderTinted: '#80868b',
    },
    prefBorderOverlayStroke: '#5f6368',
    insetFrameStroke: '#dadce0',
    insetRx: 6,
    insetCaptionFill: '#5f6368',
    terrain: {
      mountain: {
        defaultFill: '#8d6e63',
        defaultStroke: '#5d4037',
        activeFill: '#ea4335',
        activeStroke: '#a50e0e',
        hintFill: '#d93025',
        hintStroke: '#7f1d1d',
        selectedFill: '#1a73e8',
        selectedStroke: '#174ea6',
        completedFill: '#1e8e3e',
        completedStroke: '#0d652d',
        missedFill: '#f9ab00',
        missedStroke: '#764200',
        hintFittedFill: '#34a853',
        hintFittedStroke: '#137333',
        pulseRingHint: '#d93025',
        pulseRingActive: '#ea4335',
      },
      plain: {
        defaultFill: '#34a853',
        defaultStroke: '#1e8e3e',
        activeFill: '#81c995',
        activeStroke: '#ea4335',
        selectedFill: '#4285f4',
        selectedStroke: '#1a73e8',
        missedFill: '#fbbc04',
        missedStroke: '#b06000',
        completedFill: '#1e8e3e',
        completedStroke: '#137333',
        hintFill: '#ea4335',
        hintStroke: '#d93025',
        hintFittedFill: '#34a853',
        hintFittedStroke: '#137333',
      },
      lake: {
        defaultFill: '#1a73e8',
        defaultStroke: '#174ea6',
        completedFill: '#1a73e8',
        completedStroke: '#174ea6',
        activeFill: '#4285f4',
        activeStroke: '#ea4335',
        selectedFill: '#4285f4',
        selectedStroke: '#174ea6',
        missedFill: '#fbbc04',
        missedStroke: '#b06000',
        hintFill: '#4285f4',
        hintStroke: '#d93025',
        hintFittedFill: '#34a853',
        hintFittedStroke: '#137333',
        smallRingHint: '#d93025',
        smallRingActive: '#ea4335',
      },
      river: {
        defaultStroke: '#4285f4',
        completedStroke: '#1a73e8',
        selectedStroke: '#1557b0',
        activeStroke: '#ea4335',
        hintStroke: '#d93025',
        missedStroke: '#f29900',
        hintFittedStroke: '#1e8e3e',
      },
      mountains: {
        zoneDefaultFill: '#8d6e63',
        zoneDefaultStroke: '#795548',
        zoneCompletedStroke: '#795548',
        zoneActiveStroke: '#ea4335',
        zoneHintStroke: '#d93025',
        zoneSelectedFill: '#1a73e8',
        zoneSelectedStroke: '#1a73e8',
        zoneMissedFill: '#f29900',
        zoneMissedStroke: '#f29900',
        zoneHintFittedFill: '#1e8e3e',
        zoneHintFittedStroke: '#1e8e3e',
        ridgeDefaultStroke: '#6d4c41',
        ridgeActiveStroke: '#ea4335',
        ridgeHintStroke: '#d93025',
        ridgeSelectedStroke: '#1a73e8',
        ridgeMissedStroke: '#f29900',
        ridgeHintFittedStroke: '#1e8e3e',
      },
    },
    hint1Fill: 'rgba(251, 188, 4, 0.16)',
    hint1Stroke: '#f29900',
    hint1LabelFill: '#764200',
    hint2PulseFill: 'rgba(30, 142, 62, 0.16)',
    hint2PulseStroke: '#1e8e3e',
    nonTerrainPulseHint: '#d93025',
    nonTerrainPulseActive: '#ea4335',
    capitalPinStroke: '#ea4335',
    capitalPinFill: '#ea4335',
    tagDotFill: '#8430ce',
    labelDefaultFill: '#202124',
    labelSelectedFill: '#1a73e8',
    labelHintFittedFill: '#137333',
  },
};

function getHypsometricColor(piece: MapPieceItem, palette: MapThemePalette): string {
  let h = 0;
  for (let i = 0; i < piece.id.length; i += 1) {
    h = (h * 31 + piece.id.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % palette.hypsometric.length;
  return palette.hypsometric[idx];
}

type TerrainCategory = GeographyFeature['category'];

const LABEL_TO_GEO_CATEGORY: Record<string, TerrainCategory> = {
  山: 'mountain',
  '山脈・山地・高地': 'mountains',
  河川: 'river',
  平野: 'plain',
  湖: 'lake',
};

const TERRAIN_CATEGORY_ORDER: Record<TerrainCategory, number> = {
  plain: 0,
  mountains: 1,
  river: 2,
  lake: 3,
  mountain: 4,
};

function resolveGeoCategory(piece: MapPieceItem): TerrainCategory {
  return piece.geoCategory ?? LABEL_TO_GEO_CATEGORY[piece.regionLabel] ?? 'mountain';
}

function getMountainPeakHalfWidth(viewBoxW: number): number {
  return Math.max(2.6, Math.min(7.5, viewBoxW * 0.0085));
}

function computeTerrainGeomCache(piece: MapPieceItem): { ptsStr: string; rawSpan: number } {
  const pts = piece.linePts ?? [];
  if (pts.length === 0) {
    return {
      ptsStr: '',
      rawSpan: Math.max(piece.bbox[2] - piece.bbox[0], piece.bbox[3] - piece.bbox[1]),
    };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const parts: string[] = new Array(pts.length);
  for (let i = 0; i < pts.length; i += 1) {
    const [x, y] = pts[i];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    parts[i] = `${x.toFixed(2)},${y.toFixed(2)}`;
  }
  const rawSpan = Number.isFinite(minX)
    ? Math.max(maxX - minX, maxY - minY)
    : Math.max(piece.bbox[2] - piece.bbox[0], piece.bbox[3] - piece.bbox[1]);
  return { ptsStr: parts.join(' '), rawSpan };
}

interface PlacedLabel {
  piece: MapPieceItem;
  label: string;
  x: number;
  y: number;
  fontSize: number;
  isHintFitted: boolean;
  isSelected: boolean;
}

const MapCanvasInner: React.FC<MapCanvasProps> = ({
  svgRef,
  viewBox,
  viewBoxString,
  targetPieces,
  poolPieces,
  contextPieces,
  bgPrefPieces,
  insets,
  completedIds,
  missedIds,
  activePieceId,
  hintPieceId,
  selectedPieceId,
  config,
  tags,
  forceShowNames = false,
  showCapitalMarks = false,
  swapCapitalLabel = false,
  hoverTargetId = null,
  isTerrainMode = false,
  enablePrefHoverTooltip = false,
  enablePrefTint = false,
  hintArea = null,
  hintFittedPieceId = null,
  onPieceClick,
  onPanBy,
  onFinishPan,
  onZoomByFactor,
}) => {
  const localSvgRef = useRef<SVGSVGElement | null>(null);
  const prefTooltipRef = useRef<HTMLDivElement | null>(null);
  const [svgNode, setSvgNode] = useState<SVGSVGElement | null>(null);
  const [svgSize, setSvgSize] = useState<{ w: number; h: number }>({ w: 1200, h: 720 });
  const isGoogle = config.uiTheme === 'google';
  const uiTheme: UiTheme = isGoogle ? 'google' : 'classic';
  const palette = MAP_PALETTES[uiTheme];

  const hidePrefTooltip = useCallback(() => {
    const tip = prefTooltipRef.current;
    if (tip && tip.style.opacity !== '0') {
      tip.style.opacity = '0';
    }
  }, []);

  const mergedSvgRef = useCallback(
    (node: SVGSVGElement | null) => {
      localSvgRef.current = node;
      setSvgNode(node);
      svgRef(node);
    },
    [svgRef],
  );

  // Measure rendered SVG box for exact screen-pixel-consistent label & inset sizing
  useEffect(() => {
    if (!svgNode) return;
    const syncSize = () => {
      const r = svgNode.getBoundingClientRect();
      if (r.width > 10 && r.height > 10) {
        setSvgSize((prev) =>
          Math.abs(prev.w - r.width) > 1 || Math.abs(prev.h - r.height) > 1
            ? { w: r.width, h: r.height }
            : prev,
        );
      }
    };
    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(svgNode);
    return () => ro.disconnect();
  }, [svgNode]);

  // Sync committed viewBoxString to DOM without letting unrelated renders overwrite live pan/inertia viewBox
  useLayoutEffect(() => {
    const el = localSvgRef.current;
    if (el) {
      el.setAttribute('viewBox', viewBoxString);
    }
  }, [viewBoxString]);

  const dragRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    samples: { x: number; y: number; t: number }[];
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
    samples: [],
  });

  const suppressClickRef = useRef(false);
  const touchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchPrevDistRef = useRef<number | null>(null);

  const onZoomByFactorRef = useRef(onZoomByFactor);
  const onPanByRef = useRef(onPanBy);
  const onFinishPanRef = useRef(onFinishPan);
  const enablePrefHoverTooltipRef = useRef(enablePrefHoverTooltip);
  useEffect(() => {
    onZoomByFactorRef.current = onZoomByFactor;
    onPanByRef.current = onPanBy;
    onFinishPanRef.current = onFinishPan;
    enablePrefHoverTooltipRef.current = enablePrefHoverTooltip;
    if (!enablePrefHoverTooltip) {
      hidePrefTooltip();
    }
  });

  const updatePrefTooltipAtPoint = useCallback(
    (clientX: number, clientY: number, pointerType: string) => {
      if (!enablePrefHoverTooltipRef.current) return;
      const tip = prefTooltipRef.current;
      const svg = localSvgRef.current;
      if (!tip || !svg) return;
      if ((dragRef.current.active && dragRef.current.moved) || pointerType === 'touch') {
        if (tip.style.opacity !== '0') {
          tip.style.opacity = '0';
        }
        return;
      }

      let prefName = '';
      const els = document.elementsFromPoint(clientX, clientY);
      for (let i = 0; i < els.length; i += 1) {
        const el = els[i];
        if (!svg.contains(el) && el !== svg) {
          // Stop if an opaque UI overlay (HUD, tray, modal, choice card, toast) is directly under the cursor
          if (
            el.closest(
              '.hud-topbar, .view-topbar, .hud-progress-track, .hud-zoom-rail, .hud-jump-bar, .hud-info-card, .hud-last-answer-pill, .puzzle-miss-toast, .puzzle-tray, .puzzle-single-prompt, .bottom-play-panel, .modal-backdrop, .quiz-pointing-card, .view-quick-search',
            )
          ) {
            break;
          }
          continue;
        }
        const attr = el.getAttribute('data-pref-name');
        if (attr) {
          prefName = attr;
          break;
        }
        if (el.hasAttribute('data-inset-ocean')) {
          break;
        }
      }

      if (!prefName) {
        if (tip.style.opacity !== '0') {
          tip.style.opacity = '0';
        }
        return;
      }

      if (tip.textContent !== prefName) {
        tip.textContent = prefName;
      }
      const tipW = tip.offsetWidth || 84;
      const tipH = tip.offsetHeight || 28;
      const pad = 8;
      const preferredX =
        clientX + 14 + tipW + pad > window.innerWidth
          ? clientX - tipW - 14
          : clientX + 14;
      const preferredY = clientY - 34 < pad ? clientY + 18 : clientY - 34;
      const x = Math.max(pad, Math.min(window.innerWidth - tipW - pad, preferredX));
      const y = Math.max(pad, Math.min(window.innerHeight - tipH - pad, preferredY));
      tip.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      if (tip.style.opacity !== '1') {
        tip.style.opacity = '1';
      }
    },
    [],
  );

  // Bind non-passive wheel & Safari gesture listeners for accurate trackpad pinch + mouse wheel zoom
  useEffect(() => {
    const el = localSvgRef.current;
    if (!el) return;

    let lastGestureScale = 1;
    let inSafariGesture = false;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (inSafariGesture && e.ctrlKey) return;
      if (e.deltaY === 0) return;

      if (e.ctrlKey) {
        const clamped = Math.max(-60, Math.min(60, e.deltaY));
        const factor = Math.exp(-clamped * 0.012);
        onZoomByFactorRef.current(factor, e.clientX, e.clientY);
      } else {
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        else if (e.deltaMode === 2) dy *= 400;
        const clamped = Math.max(-120, Math.min(120, dy));
        const factor = Math.exp(-clamped * 0.0028);
        onZoomByFactorRef.current(factor, e.clientX, e.clientY);
      }
    };

    const handleGestureStart = (ev: Event) => {
      const e = ev as SafariGestureEvent;
      e.preventDefault();
      inSafariGesture = true;
      lastGestureScale = e.scale || 1;
    };

    const handleGestureChange = (ev: Event) => {
      const e = ev as SafariGestureEvent;
      e.preventDefault();
      const nextScale = e.scale || 1;
      if (lastGestureScale > 0 && nextScale > 0) {
        const step = nextScale / lastGestureScale;
        lastGestureScale = nextScale;
        onZoomByFactorRef.current(step, e.clientX, e.clientY);
      }
    };

    const handleGestureEnd = (ev: Event) => {
      ev.preventDefault();
      inSafariGesture = false;
      lastGestureScale = 1;
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('gesturestart', handleGestureStart, { passive: false });
    el.addEventListener('gesturechange', handleGestureChange, { passive: false });
    el.addEventListener('gestureend', handleGestureEnd, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('gesturestart', handleGestureStart);
      el.removeEventListener('gesturechange', handleGestureChange);
      el.removeEventListener('gestureend', handleGestureEnd);
    };
  }, []);

  // Global pointer tracking while dragging/pinching the map
  useEffect(() => {
    const handleWinMove = (e: PointerEvent) => {
      if (touchPointersRef.current.has(e.pointerId)) {
        touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (touchPointersRef.current.size === 2 && pinchPrevDistRef.current != null) {
        const pts = Array.from(touchPointersRef.current.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        if (pinchPrevDistRef.current > 5 && dist > 5) {
          onZoomByFactorRef.current(dist / pinchPrevDistRef.current, midX, midY);
          pinchPrevDistRef.current = dist;
        }
        return;
      }

      const d = dragRef.current;
      if (!d.active || (d.pointerId != null && e.pointerId !== d.pointerId)) {
        updatePrefTooltipAtPoint(e.clientX, e.clientY, e.pointerType);
        return;
      }
      const dx = e.clientX - d.lastX;
      const dy = e.clientY - d.lastY;
      // Touch screens need wider tap slop than mouse so quick taps aren't swallowed as pans
      const moveThreshold = e.pointerType === 'touch' ? 9 : 4;
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > moveThreshold) {
        d.moved = true;
        localSvgRef.current?.classList.add('is-panning');
        if (prefTooltipRef.current && prefTooltipRef.current.style.opacity !== '0') {
          prefTooltipRef.current.style.opacity = '0';
        }
      }
      if (d.moved) {
        onPanByRef.current(dx, dy);
      }
      const now = performance.now();
      d.samples.push({ x: e.clientX, y: e.clientY, t: now });
      while (d.samples.length > 2 && now - d.samples[0].t > 90) {
        d.samples.shift();
      }
      d.lastX = e.clientX;
      d.lastY = e.clientY;
    };

    const handleWinUp = (e: PointerEvent) => {
      touchPointersRef.current.delete(e.pointerId);
      if (touchPointersRef.current.size < 2) {
        pinchPrevDistRef.current = null;
      }
      const d = dragRef.current;
      if (d.active && (d.pointerId == null || e.pointerId === d.pointerId)) {
        localSvgRef.current?.classList.remove('is-panning');
        if (d.moved) {
          suppressClickRef.current = true;
          window.setTimeout(() => {
            suppressClickRef.current = false;
          }, 80);

          const now = performance.now();
          let vx = 0;
          let vy = 0;
          const newest = d.samples[d.samples.length - 1];
          if (newest && now - newest.t < 45 && d.samples.length >= 2) {
            const oldest = d.samples[0];
            const spanMs = newest.t - oldest.t;
            if (spanMs >= 8) {
              vx = (newest.x - oldest.x) / spanMs;
              vy = (newest.y - oldest.y) / spanMs;
            }
          }
          onFinishPanRef.current(vx, vy);
        }
        d.active = false;
        d.moved = false;
        d.pointerId = null;
        d.samples = [];
        updatePrefTooltipAtPoint(e.clientX, e.clientY, e.pointerType);
      }
    };

    window.addEventListener('pointermove', handleWinMove);
    window.addEventListener('pointerup', handleWinUp);
    window.addEventListener('pointercancel', handleWinUp);
    window.addEventListener('blur', hidePrefTooltip);
    return () => {
      window.removeEventListener('pointermove', handleWinMove);
      window.removeEventListener('pointerup', handleWinUp);
      window.removeEventListener('pointercancel', handleWinUp);
      window.removeEventListener('blur', hidePrefTooltip);
    };
  }, [updatePrefTooltipAtPoint, hidePrefTooltip]);

  const activePoolPieces = poolPieces ?? targetPieces;
  const poolIdSet = useMemo(
    () => new Set(activePoolPieces.map((p) => p.id)),
    [activePoolPieces],
  );
  const taggedIdSet = useMemo(() => {
    const s = new Set<string>();
    if (!config.showTag) return s;
    for (const t of tags) {
      for (const pid of t.pieceIds) s.add(pid);
    }
    return s;
  }, [tags, config.showTag]);

  const insetMap = useMemo(() => {
    const m = new Map<'okinawa' | 'izu' | 'ogasawara', InsetBoxSpec>();
    for (const ins of insets) m.set(ins.id, ins);
    return m;
  }, [insets]);

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    hidePrefTooltip();
    if (e.pointerType === 'mouse') {
      e.preventDefault();
    }
    touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPointersRef.current.size === 2) {
      const pts = Array.from(touchPointersRef.current.values());
      pinchPrevDistRef.current = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      dragRef.current.active = false;
      localSvgRef.current?.classList.remove('is-panning');
      return;
    }
    const now = performance.now();
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
      samples: [{ x: e.clientX, y: e.clientY, t: now }],
    };
  };

  const handleDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    // Do not hijack rapid clicks on interactive map pieces
    const target = e.target as Element | null;
    if (target?.closest('.map-piece-clickable')) {
      return;
    }
    onZoomByFactor(1.65, e.clientX, e.clientY);
  };

  const tryPieceClick = (piece: MapPieceItem) => {
    if (dragRef.current.moved || suppressClickRef.current) return;
    onPieceClick?.(piece);
  };

  // Partition non-terrain context pieces by whether they belong in an inset box
  const { mainPieces, okiPieces, izuPieces, ogaPieces, hidePref13Bg, hidePref47Bg } =
    useMemo(() => {
      const main: MapPieceItem[] = [];
      const oki: MapPieceItem[] = [];
      const izu: MapPieceItem[] = [];
      const oga: MapPieceItem[] = [];
      const okiSpec = insetMap.get('okinawa');
      const izuSpec = insetMap.get('izu');
      const ogaSpec = insetMap.get('ogasawara');

      const hasMainMunisOfTokyo = contextPieces.some((p) => p.prefCode === '13' && p.id === '13101');

      for (const p of contextPieces) {
        if (isTerrainMode) continue;
        if (p.isOkinawa && okiSpec) {
          oki.push(p);
        } else if (p.id >= '13361' && p.id <= '13402' && izuSpec) {
          izu.push(p);
        } else if (p.id === '13421' && ogaSpec) {
          oga.push(p);
        } else {
          main.push(p);
        }
      }
      return {
        mainPieces: main,
        okiPieces: oki,
        izuPieces: izu,
        ogaPieces: oga,
        hidePref13Bg: hasMainMunisOfTokyo && (Boolean(izuSpec) || Boolean(ogaSpec)),
        hidePref47Bg: Boolean(okiSpec) && bgPrefPieces.some((p) => p.id === 'pref_47'),
      };
    }, [contextPieces, insetMap, isTerrainMode, bgPrefPieces]);

  const isPrefDirectMode = useMemo(
    () =>
      !isTerrainMode &&
      bgPrefPieces.length > 0 &&
      contextPieces.length === bgPrefPieces.length &&
      contextPieces.every((p) => p.id.startsWith('pref_')),
    [isTerrainMode, bgPrefPieces.length, contextPieces],
  );

  const showPrefBorderOverlay =
    enablePrefTint &&
    !isTerrainMode &&
    bgPrefPieces.length > 0 &&
    !isPrefDirectMode &&
    config.showBorder;

  const isPieceActionable = (piece: MapPieceItem): boolean =>
    Boolean(onPieceClick) &&
    (forceShowNames || poolIdSet.has(piece.id) || completedIds.has(piece.id));

  const getPieceStyle = (piece: MapPieceItem) => {
    const isCompleted = completedIds.has(piece.id);
    const isMissedCompleted = isCompleted && Boolean(missedIds?.has(piece.id));
    const isActive = activePieceId === piece.id;
    const isHint = hintPieceId === piece.id;
    const isHintFitted = hintFittedPieceId === piece.id;
    const isSelected = selectedPieceId === piece.id;
    const isHover = hoverTargetId === piece.id;
    const isInPool = poolIdSet.has(piece.id);
    const p = palette.piece;

    let fill = config.silhouette
      ? enablePrefTint
        ? getPrefMutedFill(piece.prefCode, false, uiTheme)
        : p.silhouetteLand
      : getHypsometricColor(piece, palette);
    let stroke = config.showBorder ? p.borderNormal : fill;
    let strokeWidth = config.showBorder ? 0.9 : 0.65;

    if (!isInPool && contextPieces.length > activePoolPieces.length) {
      // Context piece outside current geographic sub-region or non-city town/village in cities mode
      fill = config.silhouette
        ? enablePrefTint
          ? getPrefMutedFill(piece.prefCode, true, uiTheme)
          : p.contextSilhouette
        : p.contextHypsometric;
      stroke = config.showBorder ? p.borderContext : fill;
      strokeWidth = enablePrefTint && config.silhouette ? 0.55 : 0.6;
    }

    if (isCompleted) {
      if (isMissedCompleted) {
        fill = config.silhouette
          ? p.completedMissedSilhouetteFill
          : p.completedMissedHypsoFill;
        stroke = config.showBorder ? p.completedMissedStroke : fill;
        strokeWidth = config.showBorder ? 1.25 : 0.8;
      } else {
        fill = config.silhouette ? p.completedCleanSilhouetteFill : p.completedCleanHypsoFill;
        stroke = config.showBorder
          ? config.silhouette
            ? p.completedCleanSilhouetteStroke
            : p.completedCleanHypsoStroke
          : fill;
        strokeWidth = config.showBorder ? 1.1 : 0.75;
      }
    }
    if (isHover) {
      fill = p.hoverFill;
      stroke = p.hoverStroke;
      strokeWidth = 1.9;
    }
    if (isSelected) {
      fill = p.selectedFill;
      stroke = p.selectedStroke;
      strokeWidth = 1.8;
    }
    if (isActive) {
      fill = p.activeFill;
      stroke = p.activeStroke;
      strokeWidth = 2.1;
    }
    if (isHint) {
      fill = p.hintFill;
      stroke = p.hintStroke;
      strokeWidth = 2.4;
    }
    if (isHintFitted) {
      fill = p.hintFittedFill;
      stroke = p.hintFittedStroke;
      strokeWidth = 2.4;
    }

    return { fill, stroke, strokeWidth };
  };

  // True screen-pixel-consistent scaling (no fixed SVG floor that balloons at high zoom!)
  const pxPerSvgUnit = Math.max(
    0.01,
    Math.min(
      svgSize.w / Math.max(0.05, viewBox.w),
      svgSize.h / Math.max(0.05, viewBox.h),
    ),
  );
  const targetLabelPx = svgSize.w < 520 ? 10.5 : 11.5;
  const labelFontSize = targetLabelPx / pxPerSvgUnit;
  const capitalPinR = Math.max(1.2, Math.min(4.2, viewBox.w * 0.0032));

  const getCappedHitRadius = (piece: MapPieceItem, insetScale = 1): number => {
    const base = Math.min(
      viewBox.w * 0.006,
      Math.max(0.45, Math.sqrt(Math.max(0.1, piece.areaPx)) * 0.9),
    );
    return insetScale === 1 ? base : Math.min((viewBox.w * 0.006) / insetScale, Math.max(0.9, base / insetScale));
  };

  const renderPieceRawGroup = (
    pieces: MapPieceItem[],
    inset?: InsetBoxSpec,
  ) => {
    if (pieces.length === 0) return null;

    const tinyAssistCircles = pieces.map((piece) => {
      if (piece.areaPx >= 3) return null;
      const actionable = isPieceActionable(piece);
      if (!actionable) return null;
      const isHover = hoverTargetId === piece.id;
      const piecePrefName =
        piece.prefName || (piece.id.startsWith('pref_') ? piece.name : '');
      const cx = inset ? (piece.center[0] - inset.tx) / inset.scale : piece.center[0];
      const cy = inset ? (piece.center[1] - inset.ty) / inset.scale : piece.center[1];
      const r = getCappedHitRadius(piece, inset ? inset.scale : 1);
      return (
        <circle
          key={`hit-${piece.id}`}
          data-piece-id={piece.id}
          data-pref-name={piecePrefName}
          cx={cx}
          cy={cy}
          r={r}
          fill="transparent"
          stroke={isHover ? palette.piece.hoverStroke : 'none'}
          strokeWidth={isHover ? 1.3 : 0}
          vectorEffect="non-scaling-stroke"
          className="map-piece-clickable"
          onClick={() => tryPieceClick(piece)}
        />
      );
    });

    const piecePaths = pieces.map((piece) => {
      const st = getPieceStyle(piece);
      const actionable = isPieceActionable(piece);
      const piecePrefName =
        piece.prefName || (piece.id.startsWith('pref_') ? piece.name : '');
      return (
        <g
          key={piece.id}
          onClick={actionable ? () => tryPieceClick(piece) : undefined}
          className={actionable ? 'map-piece-clickable' : undefined}
        >
          <path
            data-piece-id={piece.id}
            data-pref-name={piecePrefName}
            d={piece.path}
            fill={st.fill}
            fillRule="evenodd"
            stroke={st.stroke}
            strokeWidth={st.strokeWidth}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        </g>
      );
    });

    if (!inset) {
      return (
        <>
          <g className="tiny-hit-assist-layer">{tinyAssistCircles}</g>
          <g className="map-pieces-layer">{piecePaths}</g>
        </>
      );
    }

    return (
      <g key={`inset-group-${inset.id}`} clipPath={`url(#${inset.clipId})`}>
        <g transform={`translate(${inset.tx.toFixed(3)}, ${inset.ty.toFixed(3)}) scale(${inset.scale.toFixed(5)})`}>
          <g className="tiny-hit-assist-layer">{tinyAssistCircles}</g>
          <g className="map-pieces-layer">{piecePaths}</g>
        </g>
      </g>
    );
  };

  /** Elevated outline/highlight overlays rendered above neighbors & prefecture borders */
  const renderElevatedPieceOverlays = (pieces: MapPieceItem[]) => {
    if (isTerrainMode || pieces.length === 0) return null;
    const priorityIds = [
      hoverTargetId,
      selectedPieceId,
      activePieceId,
      hintPieceId,
      hintFittedPieceId,
    ].filter((id): id is string => Boolean(id));
    if (priorityIds.length === 0) return null;

    const seen = new Set<string>();
    const nodes: React.ReactNode[] = [];
    for (const id of priorityIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const piece = pieces.find((p) => p.id === id);
      if (!piece || !piece.path) continue;
      const isHintFitted = id === hintFittedPieceId;
      if (isHintFitted) {
        nodes.push(
          <g key={`elev-${piece.id}`} className="hint-fitted-shape" pointerEvents="none">
            <path
              d={piece.path}
              fill="none"
              stroke={palette.piece.elevatedHaloStroke}
              strokeOpacity={0.96}
              strokeWidth={5.2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={piece.path}
              fill={palette.piece.hintFittedFill}
              fillRule="evenodd"
              stroke={palette.piece.hintFittedStroke}
              strokeWidth={2.4}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>,
        );
      } else {
        const st = getPieceStyle(piece);
        nodes.push(
          <g key={`elev-${piece.id}`} className="elevated-piece-outline" pointerEvents="none">
            <path
              d={piece.path}
              fill="none"
              stroke={palette.piece.elevatedHaloStroke}
              strokeOpacity={0.85}
              strokeWidth={st.strokeWidth + 2.0}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={piece.path}
              fill="none"
              stroke={st.stroke}
              strokeWidth={st.strokeWidth}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>,
        );
      }
    }
    return nodes.length > 0 ? <>{nodes}</> : null;
  };

  const renderBgPrefPath = (pref: MapPieceItem, keyPrefix: string) => {
    const useTint = enablePrefTint && config.silhouette && !isTerrainMode;
    const bg = palette.bgPref;
    const fill = isTerrainMode
      ? bg.terrainLand
      : useTint
        ? getPrefMutedFill(pref.prefCode, false, uiTheme)
        : config.silhouette
          ? bg.silhouetteLand
          : bg.hypsoLand;
    const stroke = config.showBorder
      ? isTerrainMode
        ? bg.borderNormal
        : useTint
          ? bg.borderTinted
          : bg.borderNormal
      : fill;
    const strokeWidth = isTerrainMode ? 0.8 : useTint ? 0.9 : 0.7;
    return (
      <path
        key={`${keyPrefix}-${pref.id}`}
        data-pref-name={pref.name}
        d={pref.path}
        fill={fill}
        fillRule="evenodd"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        pointerEvents={enablePrefHoverTooltip ? 'visiblePainted' : 'none'}
      />
    );
  };

  const renderBgPrefectures = () => {
    if (isPrefDirectMode) return null;
    const okiSpec = insetMap.get('okinawa');
    return bgPrefPieces.map((pref) => {
      if (hidePref13Bg && pref.id === 'pref_13') return null;
      if (pref.isOkinawa && hidePref47Bg) return null;
      if (pref.isOkinawa && okiSpec) {
        return (
          <g key={`bg-${pref.id}`} clipPath={`url(#${okiSpec.clipId})`}>
            <g
              transform={`translate(${okiSpec.tx.toFixed(3)}, ${okiSpec.ty.toFixed(3)}) scale(${okiSpec.scale.toFixed(5)})`}
            >
              {renderBgPrefPath(pref, 'bg-oki')}
            </g>
          </g>
        );
      }
      return renderBgPrefPath(pref, 'bg');
    });
  };

  const terrainGeomMap = useMemo(() => {
    const map = new Map<string, { ptsStr: string; rawSpan: number }>();
    if (!isTerrainMode) return map;
    for (const p of contextPieces) {
      map.set(p.id, computeTerrainGeomCache(p));
    }
    return map;
  }, [isTerrainMode, contextPieces]);

  const orderedTerrainPieces = useMemo(() => {
    if (!isTerrainMode) return [];
    const statusRank = (id: string): number => {
      if (id === hintFittedPieceId) return 4;
      if (id === hintPieceId || id === activePieceId) return 3;
      if (id === selectedPieceId) return 2;
      if (completedIds.has(id)) return 1;
      return 0;
    };
    return [...contextPieces].sort((a, b) => {
      const sa = statusRank(a.id);
      const sb = statusRank(b.id);
      if (sa !== sb) return sa - sb;
      return TERRAIN_CATEGORY_ORDER[resolveGeoCategory(a)] - TERRAIN_CATEGORY_ORDER[resolveGeoCategory(b)];
    });
  }, [isTerrainMode, contextPieces, completedIds, activePieceId, hintPieceId, hintFittedPieceId, selectedPieceId]);

  const renderTerrainLayer = () => {
    if (!isTerrainMode) return null;
    const baseMountainHw = getMountainPeakHalfWidth(viewBox.w);

    return (
      <g>
        {orderedTerrainPieces.map((f) => {
          const isCompleted = completedIds.has(f.id);
          const isMissedCompleted = isCompleted && Boolean(missedIds?.has(f.id));
          const isActive = activePieceId === f.id;
          const isHint = hintPieceId === f.id;
          const isHintFitted = hintFittedPieceId === f.id;
          const isSelected = selectedPieceId === f.id;
          const highlighted = isHintFitted || isActive || isHint;
          const actionable = isPieceActionable(f);
          const clickableClass = actionable ? 'map-piece-clickable' : undefined;
          const cat = resolveGeoCategory(f);
          const hasPath = Boolean(f.path && f.path.trim().length > 0);
          const pts = f.linePts ?? [];
          const cached = terrainGeomMap.get(f.id);
          const ptsStr = cached?.ptsStr ?? '';
          const rawSpan =
            cached?.rawSpan ?? Math.max(f.bbox[2] - f.bbox[0], f.bbox[3] - f.bbox[1]);

          if (cat === 'mountain') {
            const mt = palette.terrain.mountain;
            const [cx, cy] = f.center;
            const hw = isHintFitted
              ? baseMountainHw * 1.24
              : highlighted
                ? baseMountainHw * 1.18
                : isSelected
                  ? baseMountainHw * 1.1
                  : baseMountainHw;
            const h = hw * 1.55;
            const apexY = cy - (h * 2) / 3;
            const baseY = cy + h / 3;
            const peakPts = `${cx.toFixed(2)},${apexY.toFixed(2)} ${(cx - hw).toFixed(2)},${baseY.toFixed(2)} ${(cx + hw).toFixed(2)},${baseY.toFixed(2)}`;
            const sY = apexY + h * 0.36;
            const sYLow = apexY + h * 0.44;
            const sW = hw * 0.36;
            const snowPts = `${cx.toFixed(2)},${apexY.toFixed(2)} ${(cx - sW).toFixed(2)},${sY.toFixed(2)} ${(cx - sW * 0.32).toFixed(2)},${sYLow.toFixed(2)} ${cx.toFixed(2)},${(apexY + h * 0.34).toFixed(2)} ${(cx + sW * 0.32).toFixed(2)},${sYLow.toFixed(2)} ${(cx + sW).toFixed(2)},${sY.toFixed(2)}`;

            const fill = isHintFitted
              ? mt.hintFittedFill
              : isHint
                ? mt.hintFill
                : isActive
                  ? mt.activeFill
                  : isSelected
                    ? mt.selectedFill
                    : isMissedCompleted
                      ? mt.missedFill
                      : isCompleted
                        ? mt.completedFill
                        : mt.defaultFill;
            const fillOpacity = highlighted || isSelected ? 1 : isCompleted ? 0.96 : 0.86;
            const outline = isHintFitted
              ? mt.hintFittedStroke
              : isHint
                ? mt.hintStroke
                : isActive
                  ? mt.activeStroke
                  : isSelected
                    ? mt.selectedStroke
                    : isMissedCompleted
                      ? mt.missedStroke
                      : isCompleted
                        ? mt.completedStroke
                        : mt.defaultStroke;

            return (
              <g
                key={f.id}
                onClick={actionable ? () => tryPieceClick(f) : undefined}
                className={clickableClass}
              >
                <polygon
                  points={peakPts}
                  fill="#ffffff"
                  stroke="#ffffff"
                  strokeWidth={isHintFitted ? 5.2 : highlighted ? 4.4 : isCompleted || isSelected ? 3.2 : 2.6}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  opacity={highlighted || isCompleted || isSelected ? 0.98 : 0.88}
                />
                <polygon
                  points={peakPts}
                  fill={fill}
                  fillOpacity={fillOpacity}
                  stroke={outline}
                  strokeOpacity={highlighted || isCompleted || isSelected ? 1 : 0.9}
                  strokeWidth={isHintFitted ? 1.8 : highlighted ? 1.5 : 1.0}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                <polygon
                  points={snowPts}
                  fill="#ffffff"
                  fillOpacity={highlighted ? 0.94 : isCompleted ? 0.88 : 0.8}
                  pointerEvents="none"
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={Math.max(hw * 1.5, viewBox.w * 0.012)}
                  fill="transparent"
                />
                {(isHint || isActive) && !isHintFitted && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={Math.max(hw * 2.0, viewBox.w * 0.022)}
                    fill="none"
                    stroke={isHint ? mt.pulseRingHint : mt.pulseRingActive}
                    strokeWidth={2.0}
                    strokeDasharray="4 3"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                )}
              </g>
            );
          }

          if (cat === 'plain') {
            if (!hasPath && pts.length < 3) return null;
            const pl = palette.terrain.plain;
            const fill = isHintFitted
              ? pl.hintFittedFill
              : isHint
                ? pl.hintFill
                : isActive
                  ? pl.activeFill
                  : isSelected
                    ? pl.selectedFill
                    : isMissedCompleted
                      ? pl.missedFill
                      : isCompleted
                        ? pl.completedFill
                        : pl.defaultFill;
            const fillOpacity = isHintFitted
              ? 0.62
              : isHint
                ? 0.52
                : isActive
                  ? 0.58
                  : isSelected
                    ? 0.44
                    : isCompleted
                      ? 0.52
                      : 0.34;
            const stroke = isHintFitted
              ? pl.hintFittedStroke
              : isHint
                ? pl.hintStroke
                : isActive
                  ? pl.activeStroke
                  : isSelected
                    ? pl.selectedStroke
                    : isMissedCompleted
                      ? pl.missedStroke
                      : isCompleted
                        ? pl.completedStroke
                        : pl.defaultStroke;
            const strokeOpacity = highlighted || isSelected ? 1 : isCompleted ? 0.88 : 0.62;
            const strokeWidth = isHintFitted
              ? 2.9
              : isHint
                ? 2.7
                : isActive
                  ? 2.4
                  : isSelected
                    ? 2.0
                    : isCompleted
                      ? 1.4
                      : 1.05;
            const showHalo = highlighted || isSelected;
            const haloWidth = isHintFitted ? 5.8 : isHint ? 5.2 : isActive ? 4.8 : 4.0;

            return (
              <g
                key={f.id}
                onClick={actionable ? () => tryPieceClick(f) : undefined}
                className={clickableClass}
              >
                {showHalo &&
                  (hasPath ? (
                    <path
                      d={f.path}
                      fill="none"
                      stroke="#ffffff"
                      strokeOpacity={0.94}
                      strokeWidth={haloWidth}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  ) : (
                    <polygon
                      points={ptsStr}
                      fill="none"
                      stroke="#ffffff"
                      strokeOpacity={0.94}
                      strokeWidth={haloWidth}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  ))}
                {hasPath ? (
                  <path
                    d={f.path}
                    fill={fill}
                    fillOpacity={fillOpacity}
                    fillRule="evenodd"
                    stroke={stroke}
                    strokeOpacity={strokeOpacity}
                    strokeWidth={strokeWidth}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <polygon
                    points={ptsStr}
                    fill={fill}
                    fillOpacity={fillOpacity}
                    stroke={stroke}
                    strokeOpacity={strokeOpacity}
                    strokeWidth={strokeWidth}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </g>
            );
          }

          if (cat === 'lake') {
            if (!hasPath && pts.length < 3) return null;
            const lk = palette.terrain.lake;
            const isSmallLake = rawSpan < viewBox.w * 0.04;
            const isVerySmallLake = rawSpan < Math.max(12, viewBox.w * 0.025);
            const showHalo = highlighted || isSelected || isVerySmallLake;
            const haloWidth = isHintFitted
              ? isSmallLake
                ? 8.8
                : 7.8
              : isHint
                ? isSmallLake
                  ? 8.4
                  : 7.4
                : isActive
                  ? isSmallLake
                    ? 7.8
                    : 6.8
                  : isSelected
                    ? isSmallLake
                      ? 6.4
                      : 5.6
                    : isCompleted
                      ? 4.0
                      : 3.0;
            const haloOpacity = highlighted
              ? 0.96
              : isSelected
                ? 0.9
                : isCompleted
                  ? 0.78
                  : 0.6;

            const fill = isHintFitted
              ? lk.hintFittedFill
              : isHint
                ? lk.hintFill
                : isActive
                  ? lk.activeFill
                  : isSelected
                    ? lk.selectedFill
                    : isMissedCompleted
                      ? lk.missedFill
                      : isCompleted
                        ? lk.completedFill
                        : lk.defaultFill;
            const fillOpacity = isHintFitted
              ? 0.98
              : isHint
                ? 0.96
                : isActive
                  ? 0.95
                  : isSelected
                    ? 0.92
                    : isCompleted
                      ? 0.9
                      : 0.76;
            const stroke = isHintFitted
              ? lk.hintFittedStroke
              : isHint
                ? lk.hintStroke
                : isActive
                  ? lk.activeStroke
                  : isSelected
                    ? lk.selectedStroke
                    : isMissedCompleted
                      ? lk.missedStroke
                      : isCompleted
                        ? lk.completedStroke
                        : lk.defaultStroke;
            const strokeOpacity = highlighted || isSelected ? 1 : isCompleted ? 0.95 : 0.86;
            const strokeWidth = isHintFitted
              ? isSmallLake
                ? 5.2
                : 4.6
              : isHint
                ? isSmallLake
                  ? 5.0
                  : 4.4
                : isActive
                  ? isSmallLake
                    ? 4.6
                    : 4.0
                  : isSelected
                    ? 3.6
                    : isCompleted
                      ? 2.4
                      : isVerySmallLake
                        ? 2.0
                        : 1.6;

            return (
              <g
                key={f.id}
                onClick={actionable ? () => tryPieceClick(f) : undefined}
                className={clickableClass}
              >
                {showHalo &&
                  (hasPath ? (
                    <path
                      d={f.path}
                      fill="none"
                      stroke="#ffffff"
                      strokeOpacity={haloOpacity}
                      strokeWidth={haloWidth}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  ) : (
                    <polygon
                      points={ptsStr}
                      fill="none"
                      stroke="#ffffff"
                      strokeOpacity={haloOpacity}
                      strokeWidth={haloWidth}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  ))}
                {hasPath ? (
                  <path
                    d={f.path}
                    fill={fill}
                    fillOpacity={fillOpacity}
                    fillRule="evenodd"
                    stroke={stroke}
                    strokeOpacity={strokeOpacity}
                    strokeWidth={strokeWidth}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <polygon
                    points={ptsStr}
                    fill={fill}
                    fillOpacity={fillOpacity}
                    stroke={stroke}
                    strokeOpacity={strokeOpacity}
                    strokeWidth={strokeWidth}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {isVerySmallLake && (
                  <circle
                    cx={f.center[0]}
                    cy={f.center[1]}
                    r={Math.max(4.5, viewBox.w * 0.014)}
                    fill="transparent"
                  />
                )}
                {(isHint || isActive) && !isHintFitted && isSmallLake && (
                  <circle
                    cx={f.center[0]}
                    cy={f.center[1]}
                    r={Math.max(
                      rawSpan * 0.8 + viewBox.w * 0.008,
                      Math.max(4.5, viewBox.w * 0.02),
                    )}
                    fill="none"
                    stroke={isHint ? lk.smallRingHint : lk.smallRingActive}
                    strokeWidth={2.0}
                    strokeDasharray="4 3"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                )}
              </g>
            );
          }

          if (cat === 'river') {
            if (!hasPath && pts.length < 2) return null;
            const rv = palette.terrain.river;
            const casingWidth = isHintFitted
              ? 7.4
              : isHint
                ? 6.6
                : isActive
                  ? 6.0
                  : isSelected
                    ? 5.2
                    : isCompleted
                      ? 4.2
                      : 2.8;
            const casingOpacity = highlighted ? 0.96 : isSelected ? 0.92 : isCompleted ? 0.82 : 0.55;
            const stroke = isHintFitted
              ? rv.hintFittedStroke
              : isHint
                ? rv.hintStroke
                : isActive
                  ? rv.activeStroke
                  : isSelected
                    ? rv.selectedStroke
                    : isMissedCompleted
                      ? rv.missedStroke
                      : isCompleted
                        ? rv.completedStroke
                        : rv.defaultStroke;
            const strokeOpacity = highlighted || isSelected ? 1 : isCompleted ? 0.95 : 0.72;
            const strokeWidth = isHintFitted
              ? 4.2
              : isHint
                ? 3.9
                : isActive
                  ? 3.6
                  : isSelected
                    ? 3.1
                    : isCompleted
                      ? 2.4
                      : 1.95;

            return (
              <g
                key={f.id}
                onClick={actionable ? () => tryPieceClick(f) : undefined}
                className={clickableClass}
              >
                {hasPath ? (
                  <path
                    d={f.path}
                    fill="none"
                    stroke="#ffffff"
                    strokeOpacity={casingOpacity}
                    strokeWidth={casingWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                ) : (
                  <polyline
                    points={ptsStr}
                    fill="none"
                    stroke="#ffffff"
                    strokeOpacity={casingOpacity}
                    strokeWidth={casingWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                )}
                {hasPath ? (
                  <path
                    d={f.path}
                    fill="none"
                    stroke={stroke}
                    strokeOpacity={strokeOpacity}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <polyline
                    points={ptsStr}
                    fill="none"
                    stroke={stroke}
                    strokeOpacity={strokeOpacity}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {hasPath ? (
                  <path
                    d={f.path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={10}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <polyline
                    points={ptsStr}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={10}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </g>
            );
          }

          // mountains (山脈・山地・高地)
          if (!hasPath && pts.length < 2) return null;
          const mts = palette.terrain.mountains;
          const zoneFill = isHintFitted
            ? mts.zoneHintFittedFill
            : isSelected
              ? mts.zoneSelectedFill
              : isMissedCompleted
                ? mts.zoneMissedFill
                : mts.zoneDefaultFill;
          const zoneFillOpacity = isHintFitted
            ? 0.48
            : isHint
              ? 0.48
              : isActive
                ? 0.46
                : isSelected
                  ? 0.3
                  : isCompleted
                    ? 0.36
                    : 0.24;
          const zoneStroke = isHintFitted
            ? mts.zoneHintFittedStroke
            : isHint
              ? mts.zoneHintStroke
              : isActive
                ? mts.zoneActiveStroke
                : isSelected
                  ? mts.zoneSelectedStroke
                  : isMissedCompleted
                    ? mts.zoneMissedStroke
                    : isCompleted
                      ? mts.zoneCompletedStroke
                      : mts.zoneDefaultStroke;
          const zoneStrokeOpacity = highlighted || isSelected ? 0.95 : isCompleted ? 0.58 : 0.4;
          const zoneStrokeWidth = isHintFitted
            ? 2.2
            : isHint
              ? 2.0
              : isActive
                ? 1.7
                : isSelected
                  ? 1.6
                  : isCompleted
                    ? 1.1
                    : 0.9;

          const ridgeStroke = isHintFitted
            ? mts.ridgeHintFittedStroke
            : isHint
              ? mts.ridgeHintStroke
              : isActive
                ? mts.ridgeActiveStroke
                : isSelected
                  ? mts.ridgeSelectedStroke
                  : isMissedCompleted
                    ? mts.ridgeMissedStroke
                    : mts.ridgeDefaultStroke;
          const ridgeOpacity = highlighted || isSelected ? 1 : isCompleted ? 0.92 : 0.68;
          const ridgeWidth = isHintFitted
            ? 4.0
            : isHint
              ? 3.7
              : isActive
                ? 3.4
                : isSelected
                  ? 3.0
                  : isCompleted
                    ? 2.6
                    : 2.2;
          const showRidgeCasing = highlighted || isSelected;

          return (
            <g
              key={f.id}
              onClick={actionable ? () => tryPieceClick(f) : undefined}
              className={clickableClass}
            >
              {hasPath && (
                <path
                  d={f.path}
                  fill={zoneFill}
                  fillOpacity={zoneFillOpacity}
                  fillRule="evenodd"
                  stroke={zoneStroke}
                  strokeOpacity={zoneStrokeOpacity}
                  strokeWidth={zoneStrokeWidth}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {pts.length >= 2 && showRidgeCasing && (
                <polyline
                  points={ptsStr}
                  fill="none"
                  stroke="#ffffff"
                  strokeOpacity={0.94}
                  strokeWidth={isHintFitted ? 6.8 : isHint ? 6.2 : isActive ? 5.8 : 4.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              )}
              {pts.length >= 2 && (
                <polyline
                  points={ptsStr}
                  fill="none"
                  stroke={ridgeStroke}
                  strokeOpacity={ridgeOpacity}
                  strokeWidth={ridgeWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={highlighted || isCompleted ? '7 3' : '6 3'}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {pts.length >= 2 && (
                <polyline
                  points={ptsStr}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={10}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </g>
          );
        })}
      </g>
    );
  };

  // Greedy 2D bbox collision-free map label placement
  const placedLabels = useMemo((): PlacedLabel[] => {
    const hasSubPool = contextPieces.length > activePoolPieces.length;
    const padX = viewBox.w * 0.14;
    const padY = viewBox.h * 0.14;
    const minVx = viewBox.x - padX;
    const maxVx = viewBox.x + viewBox.w + padX;
    const minVy = viewBox.y - padY;
    const maxVy = viewBox.y + viewBox.h + padY;

    interface Candidate {
      piece: MapPieceItem;
      label: string;
      x: number;
      y: number;
      fontSize: number;
      isHintFitted: boolean;
      isSelected: boolean;
      priority: number;
      score: number;
      halfW: number;
      halfH: number;
    }

    const candidates: Candidate[] = [];
    for (let i = 0; i < contextPieces.length; i += 1) {
      const p = contextPieces[i];
      const isHintFitted = hintFittedPieceId === p.id;
      const isSelected = selectedPieceId === p.id;
      const isCompleted = completedIds.has(p.id);
      const isInPool = poolIdSet.has(p.id);

      const shouldDraw =
        isHintFitted ||
        isSelected ||
        (config.nameOnFix && isCompleted) ||
        (forceShowNames && (!hasSubPool || isInPool));
      if (!shouldDraw) continue;

      const [cx, cy] = p.center;
      if (cx < minVx || cx > maxVx || cy < minVy || cy > maxVy) continue;

      const label = swapCapitalLabel && p.adminAreaLabel ? p.adminAreaLabel : p.name;
      const thisFontSize = isHintFitted
        ? labelFontSize * 1.15
        : isSelected
          ? labelFontSize * 1.06
          : labelFontSize;
      const estWidthSvg = Math.max(thisFontSize * 1.6, label.length * thisFontSize * 0.94) + thisFontSize * 0.45;
      const estHeightSvg = thisFontSize * 1.24;

      // Skip tiny polygons when zoomed far out unless priority/marker/island/terrain
      const pieceSpan = Math.max(p.bbox[2] - p.bbox[0], p.bbox[3] - p.bbox[1]);
      if (
        !isHintFitted &&
        !isSelected &&
        !isTerrainMode &&
        !p.isMarker &&
        !p.isTokyoIsland &&
        pieceSpan * pxPerSvgUnit < Math.min(18, label.length * targetLabelPx * 0.34)
      ) {
        continue;
      }

      let labelY =
        isTerrainMode && resolveGeoCategory(p) === 'mountain'
          ? cy + getMountainPeakHalfWidth(viewBox.w) * 0.55 + thisFontSize * 0.72
          : cy;

      // Offset slightly above capital pin when marks are shown so label doesn't sit directly on ◎
      if (showCapitalMarks && p.capitalCenter && !isTerrainMode) {
        const distPx = Math.hypot(cx - p.capitalCenter[0], labelY - p.capitalCenter[1]) * pxPerSvgUnit;
        if (distPx < targetLabelPx * 1.15) {
          labelY = p.capitalCenter[1] - capitalPinR - thisFontSize * 0.72;
        }
      }

      const priority = isHintFitted ? 4 : isSelected ? 3 : isCompleted ? 2 : 1;
      const score = (p.areaPx || 1) * 1.2 + Math.sqrt(Math.max(0, p.population || 0)) * 0.04;
      candidates.push({
        piece: p,
        label,
        x: cx,
        y: labelY,
        fontSize: thisFontSize,
        isHintFitted,
        isSelected,
        priority,
        score,
        halfW: estWidthSvg / 2,
        halfH: estHeightSvg / 2,
      });
    }

    candidates.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.score - a.score;
    });

    const occupied: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const accepted: PlacedLabel[] = [];
    const margin = labelFontSize * 0.12;

    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i];
      const x1 = c.x - c.halfW - margin;
      const y1 = c.y - c.halfH - margin;
      const x2 = c.x + c.halfW + margin;
      const y2 = c.y + c.halfH + margin;

      const forceAccept = c.isHintFitted || c.isSelected;
      if (!forceAccept) {
        let collides = false;
        for (let j = 0; j < occupied.length; j += 1) {
          const o = occupied[j];
          if (x1 < o.x2 && x2 > o.x1 && y1 < o.y2 && y2 > o.y1) {
            collides = true;
            break;
          }
        }
        if (collides) continue;
      }

      occupied.push({ x1, y1, x2, y2 });
      accepted.push({
        piece: c.piece,
        label: c.label,
        x: c.x,
        y: c.y,
        fontSize: c.fontSize,
        isHintFitted: c.isHintFitted,
        isSelected: c.isSelected,
      });
    }

    // Draw lowest priority first so hintFitted / selected labels always render on top
    return accepted.reverse();
  }, [
    contextPieces,
    activePoolPieces.length,
    viewBox.x,
    viewBox.y,
    viewBox.w,
    viewBox.h,
    hintFittedPieceId,
    selectedPieceId,
    completedIds,
    poolIdSet,
    config.nameOnFix,
    forceShowNames,
    swapCapitalLabel,
    labelFontSize,
    isTerrainMode,
    pxPerSvgUnit,
    targetLabelPx,
    showCapitalMarks,
    capitalPinR,
  ]);

  const hint1FontSize = (svgSize.w < 520 ? 11.5 : 13) / pxPerSvgUnit;

  return (
    <>
      <svg
        ref={mergedSvgRef}
        preserveAspectRatio="xMidYMid meet"
        className="map-canvas-svg"
        style={{
          background: config.silhouette ? palette.oceanSilhouette : palette.oceanHypsometric,
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerLeave={hidePrefTooltip}
        onDoubleClick={handleDoubleClick}
      >
        <defs>
          {insets.map((ins) => (
            <clipPath key={ins.clipId} id={ins.clipId}>
              <rect
                x={ins.box[0]}
                y={ins.box[1]}
                width={ins.box[2] - ins.box[0]}
                height={ins.box[3] - ins.box[1]}
              />
            </clipPath>
          ))}
        </defs>

        {/* Background neighboring prefectures / blank map base */}
        {renderBgPrefectures()}

        {/* Main map vector paths + behind-path tiny hit-assist circles */}
        {renderPieceRawGroup(mainPieces)}

        {/* Crisp prefecture borders above municipality maps */}
        {showPrefBorderOverlay && (
          <g className="pref-border-overlay" pointerEvents="none">
            {bgPrefPieces.map((pref) => {
              if (hidePref13Bg && pref.id === 'pref_13') return null;
              if (pref.isOkinawa && hidePref47Bg) return null;
              return (
                <path
                  key={`pref-border-${pref.id}`}
                  d={pref.path}
                  fill="none"
                  stroke={palette.prefBorderOverlayStroke}
                  strokeWidth={1.35}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              );
            })}
          </g>
        )}

        {/* Elevated active / selected / hover / hint / fitted overlays above borders */}
        {renderElevatedPieceOverlays(mainPieces)}

        {/* Inset frames + transformed island vector paths */}
        {insets.map((ins) => {
          const w = ins.box[2] - ins.box[0];
          const h = ins.box[3] - ins.box[1];
          const boxPieces =
            ins.id === 'okinawa' ? okiPieces : ins.id === 'izu' ? izuPieces : ogaPieces;
          const insetBgPieces =
            ins.id === 'okinawa' && hidePref47Bg && !isPrefDirectMode
              ? bgPrefPieces.filter((p) => p.isOkinawa)
              : [];
          const headerFontSize = Math.min(h * 0.12, (svgSize.w < 520 ? 10 : 11) / pxPerSvgUnit);
          const insetCaption =
            ins.id === 'okinawa' && forceShowNames && isPrefDirectMode
              ? '沖縄県（拡大）'
              : ins.label;
          return (
            <g key={`inset-frame-${ins.id}`}>
              <rect
                data-inset-ocean="true"
                x={ins.box[0]}
                y={ins.box[1]}
                width={w}
                height={h}
                fill={config.silhouette ? palette.oceanSilhouette : palette.oceanHypsometric}
                stroke={palette.insetFrameStroke}
                strokeWidth={1.1}
                vectorEffect="non-scaling-stroke"
                rx={palette.insetRx}
              />
              {insetBgPieces.length > 0 && (
                <g clipPath={`url(#${ins.clipId})`}>
                  <g
                    transform={`translate(${ins.tx.toFixed(3)}, ${ins.ty.toFixed(3)}) scale(${ins.scale.toFixed(5)})`}
                  >
                    {insetBgPieces.map((pref) => renderBgPrefPath(pref, `inset-bg-${ins.id}`))}
                  </g>
                </g>
              )}
              {renderPieceRawGroup(boxPieces, ins)}
              {ins.id === 'okinawa' && showPrefBorderOverlay && insetBgPieces.length > 0 && (
                <g clipPath={`url(#${ins.clipId})`} pointerEvents="none">
                  <g
                    transform={`translate(${ins.tx.toFixed(3)}, ${ins.ty.toFixed(3)}) scale(${ins.scale.toFixed(5)})`}
                  >
                    {insetBgPieces.map((pref) => (
                      <path
                        key={`inset-pref-border-${pref.id}`}
                        d={pref.path}
                        fill="none"
                        stroke={palette.prefBorderOverlayStroke}
                        strokeWidth={1.35}
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                      />
                    ))}
                  </g>
                </g>
              )}
              <g clipPath={`url(#${ins.clipId})`} pointerEvents="none">
                <g
                  transform={`translate(${ins.tx.toFixed(3)}, ${ins.ty.toFixed(3)}) scale(${ins.scale.toFixed(5)})`}
                >
                  {renderElevatedPieceOverlays(boxPieces)}
                </g>
              </g>
              <text
                x={ins.box[0] + headerFontSize * 0.45}
                y={ins.box[1] + headerFontSize * 1.2}
                fontSize={headerFontSize}
                fill={palette.insetCaptionFill}
                fontWeight={600}
                pointerEvents="none"
              >
                {insetCaption}
              </text>
            </g>
          );
        })}

        {/* Terrain 100 overlay layer */}
        {renderTerrainLayer()}

        {/* Hint 1 approximate "この辺" area circle */}
        {hintArea && (
          <g className="hint-area-group" pointerEvents="none">
            <circle
              className="hint-area-ring"
              cx={hintArea.cx}
              cy={hintArea.cy}
              r={hintArea.r}
              fill={palette.hint1Fill}
              stroke={palette.hint1Stroke}
              strokeWidth={2.6}
              strokeDasharray="8 5"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={hintArea.cx}
              y={hintArea.cy - hintArea.r - hint1FontSize * 0.45}
              textAnchor="middle"
              dominantBaseline="auto"
              fontSize={hint1FontSize}
              fontWeight={700}
              fill={palette.hint1LabelFill}
              stroke="#ffffff"
              strokeWidth={hint1FontSize * 0.28}
              paintOrder="stroke"
            >
              ヒント1：この辺
            </text>
          </g>
        )}

        {/* Hint 2 fitted object pulsing ring */}
        {hintFittedPieceId &&
          (() => {
            const p = contextPieces.find((x) => x.id === hintFittedPieceId);
            if (!p) return null;
            const pieceSpan = Math.max(p.bbox[2] - p.bbox[0], p.bbox[3] - p.bbox[1]);
            const pulseR = Math.max(
              Math.min(pieceSpan * 0.55, viewBox.w * 0.06),
              Math.max(4.5, viewBox.w * 0.024),
            );
            return (
              <g className="hint-fitted-group" pointerEvents="none">
                <circle
                  cx={p.center[0]}
                  cy={p.center[1]}
                  r={pulseR}
                  fill="none"
                  stroke="#ffffff"
                  strokeOpacity={0.92}
                  strokeWidth={4.4}
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  className="hint-fitted-pulse"
                  cx={p.center[0]}
                  cy={p.center[1]}
                  r={pulseR}
                  fill={palette.hint2PulseFill}
                  stroke={palette.hint2PulseStroke}
                  strokeWidth={2.4}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })()}

        {/* Pulse halo on active/hint non-terrain piece */}
        {!isTerrainMode &&
          (hintPieceId || activePieceId) &&
          (() => {
            const id = hintPieceId ?? activePieceId;
            if (!id || id === hintFittedPieceId) return null;
            const p = contextPieces.find((x) => x.id === id);
            if (!p) return null;
            return (
              <circle
                cx={p.center[0]}
                cy={p.center[1]}
                r={Math.max(3.5, viewBox.w * 0.022)}
                fill="none"
                stroke={hintPieceId ? palette.nonTerrainPulseHint : palette.nonTerrainPulseActive}
                strokeWidth={1.8}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            );
          })()}

        {/* Prefectural capital pin marks ◎ */}
        {showCapitalMarks &&
          contextPieces.map((p) =>
            p.capitalCenter ? (
              <g key={`cap-${p.id}`} pointerEvents="none">
                <circle
                  cx={p.capitalCenter[0]}
                  cy={p.capitalCenter[1]}
                  r={capitalPinR * 1.45}
                  fill="#ffffff"
                  fillOpacity={0.92}
                  stroke={palette.capitalPinStroke}
                  strokeWidth={1.1}
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={p.capitalCenter[0]}
                  cy={p.capitalCenter[1]}
                  r={capitalPinR * 0.62}
                  fill={palette.capitalPinFill}
                />
              </g>
            ) : null,
          )}

        {/* Tag dots */}
        {config.showTag &&
          contextPieces.map((p) =>
            taggedIdSet.has(p.id) ? (
              <circle
                key={`tag-${p.id}`}
                cx={p.center[0]}
                cy={p.center[1] - Math.max(1.0, viewBox.w * 0.0055)}
                r={Math.max(0.85, viewBox.w * 0.0036)}
                fill={palette.tagDotFill}
                stroke="#ffffff"
                strokeWidth={0.75}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            ) : null,
          )}

        {/* Collision-rejected, screen-pixel-consistent labels */}
        {placedLabels.map((item) => (
          <text
            key={`lbl-${item.piece.id}`}
            x={item.x}
            y={item.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={item.fontSize}
            fontWeight={item.isHintFitted || item.isSelected ? 800 : 600}
            fill={
              item.isHintFitted
                ? palette.labelHintFittedFill
                : item.isSelected
                  ? palette.labelSelectedFill
                  : palette.labelDefaultFill
            }
            stroke={item.isHintFitted ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.92)'}
            strokeWidth={item.fontSize * (item.isHintFitted ? 0.34 : 0.28)}
            paintOrder="stroke"
            pointerEvents="none"
          >
            {item.label}
          </text>
        ))}
      </svg>
      {enablePrefHoverTooltip && (
        <div
          ref={prefTooltipRef}
          className="pref-hover-tooltip"
          aria-hidden="true"
        />
      )}
    </>
  );
};

export const MapCanvas = React.memo(MapCanvasInner);
