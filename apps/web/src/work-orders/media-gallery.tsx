import type { MediaAsset } from '@evia/contracts';
import { CirclePlay, ImageIcon, InlineAlert, Skeleton } from '@evia/ui-web';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration, groupLabel, mediaAlt, mediaText } from './media-labels.ts';
import { UnscannedMark } from './media-unscanned.tsx';
import { MediaViewer, type MediaEraser } from './media-viewer.tsx';
import { MAX_PARALLEL_URL_REQUESTS, RequestLimiter, useSeen, useThumbnailRequest } from './media-thumbnails.ts';

// The gallery of W-09 (EVM-068 AC1, AC6, AC8; styleguide § 3.11 Thumbnail, Gallery): the photos that are `ready`, grouped by the category, tiles that
// fetch their thumbnail lazily. A tile asks for its address only when it comes near the viewport and only while the browser is online; once the
// picture is loaded the address is never replaced (a refresh would reload the image), and offline the tiles stay as they are.

/** The order of the groups: the work in progress first (W-09 mockup), then before, after, the rest. */
const GROUP_ORDER = ['in_progress', 'before_work', 'completed_work', 'site_survey', 'defect', 'measurement', 'other'] as const;

const NO_ORDER: readonly string[] = [];

interface Group {
  readonly category: string;
  readonly assets: readonly MediaAsset[];
}

export function groupByCategory(assets: readonly MediaAsset[]): Group[] {
  const known = new Set<string>(GROUP_ORDER);
  const byCategory = new Map<string, MediaAsset[]>();
  for (const asset of assets) {
    const key = known.has(asset.category) ? asset.category : 'other';
    byCategory.set(key, [...(byCategory.get(key) ?? []), asset]);
  }
  return GROUP_ORDER.flatMap((category) => {
    const group = byCategory.get(category);
    return group === undefined ? [] : [{ category, assets: group }];
  });
}

/** A group of the tiles under one heading: a category or a stage (EVM-048 AC5). */
interface Section {
  readonly key: string;
  readonly label: string;
  readonly assets: readonly MediaAsset[];
}

/**
 * "Grupuj: Etap" (EVM-048 AC5): the stages in the order of the processes (`order` = ids of the stages), then the stages that are gone from the order
 * (the name stays on the medium), and "Bez etapu" last.
 */
export function groupByStage(assets: readonly MediaAsset[], order: readonly string[]): Section[] {
  const byStage = new Map<string, MediaAsset[]>();
  const names = new Map<string, string>();
  const without: MediaAsset[] = [];
  for (const asset of assets) {
    if (asset.procedureStageId === null) {
      without.push(asset);
      continue;
    }
    byStage.set(asset.procedureStageId, [...(byStage.get(asset.procedureStageId) ?? []), asset]);
    names.set(asset.procedureStageId, asset.procedureStageName ?? mediaText.noStage);
  }
  const rank = (id: string) => {
    const index = order.indexOf(id);
    return index === -1 ? order.length : index;
  };
  const sections = [...byStage.keys()]
    .sort((a, b) => rank(a) - rank(b))
    .map((id) => ({ key: id, label: names.get(id) ?? mediaText.noStage, assets: byStage.get(id) ?? [] }));
  return without.length === 0 ? sections : [...sections, { key: 'no-stage', label: mediaText.noStage, assets: without }];
}

const altOf = mediaAlt;

function Tile({
  asset,
  workOrderId,
  online,
  limiter,
  onOpen,
}: {
  readonly onOpen: () => void;
  readonly asset: MediaAsset;
  readonly workOrderId: string;
  readonly online: boolean;
  readonly limiter: RequestLimiter;
}) {
  const ref = useRef<HTMLLIElement | null>(null);
  const seen = useSeen(ref);
  const request = useThumbnailRequest(workOrderId);
  const [src, setSrc] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const loaded = useRef(false);
  const retried = useRef(false);

  useEffect(() => {
    // no address while it is not needed: out of sight, offline, already there, or the picture cannot be shown
    if (!seen || !online || src !== null || broken) return;
    let cancelled = false;
    limiter
      .run(() => request(asset.id))
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setBroken(true);
      });
    return () => {
      cancelled = true;
    };
    // `request` is a new function on every render and would restart the effect; it only reads the client and the order, both fixed for the tile
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, online, src, broken, asset.id, limiter]);

  return (
    <li ref={ref} className="flex flex-col gap-stack-xs">
      <button
        type="button"
        aria-label={asset.mediaType === 'video' ? mediaText.openVideo(altOf(asset)) : mediaText.openPhoto(altOf(asset))}
        onClick={onOpen}
        className="relative block aspect-square w-full min-w-thumbnail-md overflow-hidden rounded-thumbnail bg-bg-skeleton focus-visible:focus-ring"
      >
        {broken ? (
          <div className="flex size-full flex-col items-center justify-center gap-stack-xs p-inset-sm text-center text-body-sm text-text-secondary">
            <ImageIcon aria-hidden="true" className="size-icon-lg text-icon-secondary" />
            <span>{mediaText.thumbnailUnavailable}</span>
          </div>
        ) : src === null ? (
          <>
            <Skeleton className="size-full" />
            <span className="sr-only">{online ? mediaText.thumbnailLoading : mediaText.thumbnailOffline}</span>
          </>
        ) : (
          <img
            src={src}
            alt={altOf(asset)}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="size-full object-cover"
            onLoad={() => {
              loaded.current = true;
            }}
            onError={() => {
              // an address that expired before the picture was fetched: ask once more; a picture that was loaded is never replaced
              if (!loaded.current && !retried.current && online) {
                retried.current = true;
                setSrc(null);
              } else if (!loaded.current) {
                setBroken(true);
              }
            }}
          />
        )}
        {asset.mediaType === 'video' ? (
          <span className="absolute bottom-0 start-0 flex items-center gap-inline-xs bg-bg-surface px-inset-xs py-inset-xs text-body-sm text-text-primary">
            <CirclePlay aria-hidden="true" className="size-icon-sm" />
            {asset.durationSeconds === null ? null : <span>{formatDuration(asset.durationSeconds)}</span>}
          </span>
        ) : null}
      </button>
      {asset.mediaType === 'video' && !asset.avScanned ? <UnscannedMark /> : null}
    </li>
  );
}

/** The groups of tiles; `online` false shows the banner "z pamięci karty" and requests nothing. */
export function MediaGallery({
  workOrderId,
  assets,
  online,
  canDownloadOriginal = false,
  canEdit = false,
  eraser,
  grouping = 'category',
  stageOrder = NO_ORDER,
}: {
  readonly workOrderId: string;
  readonly assets: readonly MediaAsset[];
  readonly online: boolean;
  /** Administrator and Editor (convenience only; the server decides). */
  readonly canDownloadOriginal?: boolean;
  /** Administrator and Editor: "Edytuj opis" in the lightbox (the server decides). */
  readonly canEdit?: boolean;
  /** Administrator: "Usuń" and "Usuń plik trwale…" in the lightbox (EVM-051). */
  readonly eraser?: MediaEraser;
  /** "Grupuj: Kategoria / Etap" of the tab (EVM-048 AC5). */
  readonly grouping?: 'category' | 'stage';
  /** The ids of the stages in the order of the processes (the order of the groups). */
  readonly stageOrder?: readonly string[];
}) {
  const limiter = useMemo(() => new RequestLimiter(MAX_PARALLEL_URL_REQUESTS), []);
  const groups = useMemo<Section[]>(
    () =>
      grouping === 'stage'
        ? groupByStage(assets, stageOrder)
        : groupByCategory(assets).map((group) => ({ key: group.category, label: groupLabel(group.category), assets: group.assets })),
    [assets, grouping, stageOrder],
  );
  const [openId, setOpenId] = useState<string | null>(null);
  // the order of the lightbox is the order of the tiles (group after group)
  const flat = useMemo(() => groups.flatMap((group) => group.assets), [groups]);
  const openIndex = openId === null ? -1 : flat.findIndex((entry) => entry.id === openId);
  if (assets.length === 0) return null;
  return (
    <div className="flex flex-col gap-stack-md">
      {online ? null : <InlineAlert tone="info">{mediaText.galleryOffline}</InlineAlert>}
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label} className="flex flex-col gap-stack-sm">
          <h4 className="text-heading-4">{mediaText.groupHeading(group.label, group.assets.length)}</h4>
          <ul
            aria-label={group.label}
            className="grid gap-inline-sm [grid-template-columns:repeat(auto-fill,minmax(var(--evm-size-thumbnail-md),1fr))]"
          >
            {group.assets.map((asset) => (
              <Tile
                key={asset.id}
                asset={asset}
                workOrderId={workOrderId}
                online={online}
                limiter={limiter}
                onOpen={() => {
                  setOpenId(asset.id);
                }}
              />
            ))}
          </ul>
        </section>
      ))}
      <MediaViewer
        workOrderId={workOrderId}
        assets={flat}
        index={openIndex < 0 ? null : openIndex}
        online={online}
        canDownloadOriginal={canDownloadOriginal}
        canEdit={canEdit}
        {...(eraser === undefined ? {} : { eraser })}
        onIndex={(index) => {
          setOpenId(flat[index]?.id ?? null);
        }}
        onClose={() => {
          setOpenId(null);
        }}
      />
    </div>
  );
}
