/**
 * Clustering constants, shared by the engine (in a Web Worker), the client and
 * the globe's zoom-level maths so every side agrees on what a level means.
 */

/** The prompt's screen-space cluster radius, in CSS pixels. */
export const CLUSTER_RADIUS_PX = 44;

/** supercluster's tile extent: at zoom z the world is TILE_PX · 2^z pixels wide. */
export const CLUSTER_TILE_PX = 512;

/**
 * The deepest level supercluster builds. Level 8 clusters hold stories within
 * about 10 km of each other, which in real data means stories GDELT pinned to
 * the same city centroid.
 */
export const CLUSTER_MAX_ZOOM = 8;

/**
 * One past the deepest cluster level: every level-8 cluster fans its stories
 * out as sunflower petals around its centre, so no story stays stacked under
 * another. Reachable from 50 km on every screen size (see clusterZoom.ts).
 */
export const PETAL_LEVEL = CLUSTER_MAX_ZOOM + 1;

/** A layout with no clustering at all: every published story is its own pin. */
export const UNCLUSTERED_LEVEL = PETAL_LEVEL + 1;

/**
 * Web Mercator stretches ground by 1 / cos(lat), so a fixed Mercator radius
 * is smaller on a globe the further it is from the equator. Calibrating at 45°
 * makes clusters exactly CLUSTER_RADIUS_PX there, ~1.4× at the equator and
 * ~0.7× at 60°: most news sits between 30° and 55° north.
 */
export const CLUSTER_REFERENCE_LAT_DEG = 45;

/** Trailing debounce on level and time changes before asking for a new layout. */
export const CLUSTER_DEBOUNCE_MS = 150;
