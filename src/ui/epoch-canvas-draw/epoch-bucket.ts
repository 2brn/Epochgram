import type { EpochCanvas } from "../epoch-canvas";
import { pickEpochBucketForViewport, EPOCH_BUCKET_TRANSITION_MS } from "../epoch-canvas-constants";
import type { EpochBucketName } from "../epoch-canvas-constants";

export type EpochBucketState = {
    epochsViewActive: boolean;
    epochBucket: EpochBucketName | null;
    prevEpochBucket: EpochBucketName | null;
    bucketFadeT: number;
};

type EpochBucketInternals = {
    epochsView?: boolean;
    scale?: number;
    epochsViewBucket?: EpochBucketName | null;
    epochsViewPrevBucket?: EpochBucketName | null;
    epochsViewBucketAnimStart?: number | null;
    requestHoverAnimation?: () => void;
    plugin?: {
        settings?: {
            enableAnimation?: boolean;
        };
    };
};

function getEpochBucketInternals(canvas: EpochCanvas): EpochBucketInternals {
    return canvas as unknown as EpochBucketInternals;
}

export function resolveEpochBucketState(canvas: EpochCanvas, now: number, viewportHeightPx: number): EpochBucketState {
    const s = getEpochBucketInternals(canvas);
    const epochsViewActive = s.epochsView === true;

    const animationsEnabled = s.plugin?.settings?.enableAnimation !== false;

    let epochBucket: EpochBucketName | null = epochsViewActive
        ? pickEpochBucketForViewport(s.scale ?? 1, viewportHeightPx)
        : null;
    let prevEpochBucket: EpochBucketName | null = null;
    let bucketFadeT = 1;

    if (epochsViewActive && epochBucket) {
        const currentBucket: EpochBucketName | null = s.epochsViewBucket ?? null;
        const prevBucket: EpochBucketName | null = s.epochsViewPrevBucket ?? null;

        if (!currentBucket) {
            s.epochsViewBucket = epochBucket;
            s.epochsViewPrevBucket = null;
            s.epochsViewBucketAnimStart = null;
        } else if (currentBucket !== epochBucket) {
            if (!animationsEnabled) {
                s.epochsViewPrevBucket = null;
                s.epochsViewBucket = epochBucket;
                s.epochsViewBucketAnimStart = null;
            } else {
                s.epochsViewPrevBucket = currentBucket;
                s.epochsViewBucket = epochBucket;
                s.epochsViewBucketAnimStart = now;
            }
        }

        epochBucket = s.epochsViewBucket ?? epochBucket;
        prevEpochBucket = prevBucket;

        const start2: number | null = s.epochsViewBucketAnimStart ?? null;
        const prev2: EpochBucketName | null = s.epochsViewPrevBucket ?? null;
        if (animationsEnabled && start2 != null && prev2 && prev2 !== epochBucket) {
            const raw = (now - start2) / Math.max(1, EPOCH_BUCKET_TRANSITION_MS);
            bucketFadeT = Math.max(0, Math.min(1, raw));
            prevEpochBucket = prev2;
            if (bucketFadeT < 1) {
                s.requestHoverAnimation?.();
            } else {
                s.epochsViewPrevBucket = null;
                s.epochsViewBucketAnimStart = null;
                prevEpochBucket = null;
            }
        } else {
            s.epochsViewPrevBucket = null;
            s.epochsViewBucketAnimStart = null;
            prevEpochBucket = null;
            bucketFadeT = 1;
        }
    } else {
        s.epochsViewBucket = null;
        s.epochsViewPrevBucket = null;
        s.epochsViewBucketAnimStart = null;
    }

    return { epochsViewActive, epochBucket, prevEpochBucket, bucketFadeT };
}
