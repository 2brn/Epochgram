import type { EpochCanvas } from "../epoch-canvas";
import { pickEpochBucketForViewport, EPOCH_BUCKET_TRANSITION_MS } from "../epoch-canvas-constants";
import type { EpochBucketName } from "../epoch-canvas-constants";

export type EpochBucketState = {
    epochsViewActive: boolean;
    epochBucket: EpochBucketName | null;
    prevEpochBucket: EpochBucketName | null;
    bucketFadeT: number;
};

export function resolveEpochBucketState(canvas: EpochCanvas, now: number, viewportHeightPx: number): EpochBucketState {
    const s: any = canvas as any;
    const epochsViewActive = (s as any).epochsView === true;

    const pluginAny: any = (canvas as any)?.plugin;
    const animationsEnabled = pluginAny?.settings?.enableAnimation !== false;

    let epochBucket: EpochBucketName | null = epochsViewActive
		? pickEpochBucketForViewport((s as any).scale ?? 1, viewportHeightPx)
		: null;
    let prevEpochBucket: EpochBucketName | null = null;
    let bucketFadeT = 1;

    if (epochsViewActive && epochBucket) {
        const currentBucket: EpochBucketName | null = (s as any).epochsViewBucket ?? null;
        const prevBucket: EpochBucketName | null = (s as any).epochsViewPrevBucket ?? null;

        if (!currentBucket) {
            (s as any).epochsViewBucket = epochBucket;
            (s as any).epochsViewPrevBucket = null;
            (s as any).epochsViewBucketAnimStart = null;
        } else if (currentBucket !== epochBucket) {
            if (!animationsEnabled) {
                (s as any).epochsViewPrevBucket = null;
                (s as any).epochsViewBucket = epochBucket;
                (s as any).epochsViewBucketAnimStart = null;
            } else {
                (s as any).epochsViewPrevBucket = currentBucket;
                (s as any).epochsViewBucket = epochBucket;
                (s as any).epochsViewBucketAnimStart = now;
            }
        }

        epochBucket = (s as any).epochsViewBucket ?? epochBucket;
        prevEpochBucket = prevBucket;

        const start2: number | null = (s as any).epochsViewBucketAnimStart ?? null;
        const prev2: EpochBucketName | null = (s as any).epochsViewPrevBucket ?? null;
        if (animationsEnabled && start2 != null && prev2 && prev2 !== epochBucket) {
            const raw = (now - start2) / Math.max(1, EPOCH_BUCKET_TRANSITION_MS);
            bucketFadeT = Math.max(0, Math.min(1, raw));
            prevEpochBucket = prev2;
            if (bucketFadeT < 1) {
                (canvas as any).requestHoverAnimation?.();
            } else {
                (s as any).epochsViewPrevBucket = null;
                (s as any).epochsViewBucketAnimStart = null;
                prevEpochBucket = null;
            }
        } else {
            (s as any).epochsViewPrevBucket = null;
            (s as any).epochsViewBucketAnimStart = null;
            prevEpochBucket = null;
            bucketFadeT = 1;
        }
    } else {
        (s as any).epochsViewBucket = null;
        (s as any).epochsViewPrevBucket = null;
        (s as any).epochsViewBucketAnimStart = null;
    }

    return { epochsViewActive, epochBucket, prevEpochBucket, bucketFadeT };
}
