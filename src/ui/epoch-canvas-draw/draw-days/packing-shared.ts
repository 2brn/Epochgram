export type PackedBlock = {
	i: number;
	height: number;
	centerY: number;
	top: number;
	bottom: number;
};

export function packVerticalBlocks(blocks: PackedBlock[], gap: number): void {
	if (blocks.length <= 1) return;

	let prevBottom = -Infinity;
	for (const b of blocks) {
		b.top = b.centerY - b.height / 2;
		b.bottom = b.centerY + b.height / 2;
		const minTop = prevBottom + gap;
		if (b.top < minTop) {
			const delta = minTop - b.top;
			b.top += delta;
			b.bottom += delta;
		}
		prevBottom = b.bottom;
	}

	let nextTop = Infinity;
	for (let idx = blocks.length - 1; idx >= 0; idx--) {
		const b = blocks[idx]!;
		const maxBottom = nextTop - gap;
		if (b.bottom > maxBottom) {
			const delta = maxBottom - b.bottom;
			b.top += delta;
			b.bottom += delta;
		}
		nextTop = b.top;
	}

	prevBottom = -Infinity;
	for (const b of blocks) {
		const minTop = prevBottom + gap;
		if (b.top < minTop) {
			const delta = minTop - b.top;
			b.top += delta;
			b.bottom += delta;
		}
		prevBottom = b.bottom;
	}
}
