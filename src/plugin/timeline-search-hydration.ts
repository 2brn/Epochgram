import { TFile } from 'obsidian'
import type { EpochPlugin } from '../main'
import { frontmatterToIndexTokens } from '../utils'
import { isTopicSimilarityEnabled } from './similarity/config'

type TimelineSearchDoc = {
	id: string
	kind: 'file'
	path: string
	basename: string
	directory: string
	meta: string
	content: string
}

type TimelineSearchIndexLike = {
	clear(): void
	upsert(doc: TimelineSearchDoc): void
}

type FileIndexDataLike = {
	reviewState?: string
	markColor?: number
	pinnedFile?: boolean
}

type TermSimilarityRecordLike = { term?: string; score?: number }

type HydrationPluginState = {
	timelineSearchIndex?: TimelineSearchIndexLike
	settings?: { similarityZeroShotMinScore?: number }
	termSimilarityLoaded?: boolean
	termSimilarityIndex?: { files?: Record<string, TermSimilarityRecordLike> }
	indexer: {
		index?: Record<string, Array<{ file?: string; summary?: string; aiSummary?: string }>>
		files?: Record<string, unknown>
		getIndexedPaths?: () => string[]
		getFileIndexData?: (path: string) => FileIndexDataLike | null
		getFileEmbeddingTerm?: (path: string) => string | null
	}
}

type FileCacheLike = {
	tags?: Array<{ tag?: string }>
	frontmatter?: Record<string, unknown>
}

export function hydrateTimelineSearchIndexFromLoadedState(plugin: EpochPlugin): void {
	try {
		const state = plugin as unknown as HydrationPluginState
		const idx = state.timelineSearchIndex
		if (!idx || typeof idx.clear !== 'function' || typeof idx.upsert !== 'function') return

		idx.clear()

		const dateIndex = state.indexer?.index ?? {}

		const summariesByPath = new Map<string, string[]>()
		for (const entries of Object.values(dateIndex)) {
			if (!Array.isArray(entries) || entries.length === 0) continue
			for (const e of entries) {
				const path = String(e?.file ?? '')
				if (!path || path.startsWith('epoch://')) continue
				let list = summariesByPath.get(path)
				if (!list) {
					list = []
					summariesByPath.set(path, list)
				}
				const summary = String(e?.summary ?? '').trim()
				if (summary) list.push(summary)
				const aiSummary = String(e?.aiSummary ?? '').trim()
				if (aiSummary) list.push(aiSummary)
			}
		}

		const paths: string[] = (() => {
			try {
				if (typeof state.indexer?.getIndexedPaths === 'function') {
					const result = state.indexer.getIndexedPaths()
					return Array.isArray(result) ? result.filter((p): p is string => typeof p === 'string') : []
				}
			} catch {
				// ignore
			}
			try {
				const filesAny = state.indexer?.files
				if (filesAny && typeof filesAny === 'object') return Object.keys(filesAny)
			} catch {
				// ignore
			}
			return []
		})()

		const coerceStringArray = (v: unknown): string[] => {
			if (!v) return []
			if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean)
			if (typeof v === 'string') return [v.trim()].filter(Boolean)
			return []
		}

		const getBasenameFromPath = (p: string): string => {
			const norm = String(p || '')
			const lastSlash = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
			const name = lastSlash >= 0 ? norm.slice(lastSlash + 1) : norm
			const lastDot = name.lastIndexOf('.')
			return lastDot > 0 ? name.slice(0, lastDot) : name
		}

		const getDirectoryFromPath = (p: string): string => {
			const norm = String(p || '')
			const lastSlash = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
			return lastSlash >= 0 ? norm.slice(0, lastSlash) : ''
		}

		for (const path of paths) {
			try {
				const p = String(path || '')
				if (!p) continue

				const metaParts: string[] = []
				const lastSlash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
				const name = lastSlash >= 0 ? p.slice(lastSlash + 1) : p
				const lastDot = name.lastIndexOf('.')
				if (lastDot > 0 && lastDot < name.length - 1) {
					metaParts.push(`ext:${name.slice(lastDot + 1)}`)
				}

				try {
					const d = typeof state.indexer?.getFileIndexData === 'function' ? state.indexer.getFileIndexData(p) : null
					const reviewState = String(d?.reviewState ?? '').trim()
					if (reviewState) metaParts.push(`review:${reviewState}`)
					const markColor = d?.markColor
					if (typeof markColor === 'number' && Number.isFinite(markColor)) metaParts.push(`mark:${markColor}`)
					if (d?.pinnedFile === true) metaParts.push('pinned')
				} catch {
					// ignore
				}

				try {
					if (typeof state.indexer?.getFileEmbeddingTerm === 'function') {
						const term = String(state.indexer.getFileEmbeddingTerm(p) || '').trim()
						if (term) metaParts.push(term)
					}
				} catch {
					// ignore
				}

				try {
					if (isTopicSimilarityEnabled(plugin)) {
						const zeroShotMinRaw = Number(state?.settings?.similarityZeroShotMinScore ?? 0)
						const zeroShotMin = Number.isFinite(zeroShotMinRaw) ? Math.max(0, Math.min(1, zeroShotMinRaw)) : 0
						const storeLoaded = state?.termSimilarityLoaded === true && !!state?.termSimilarityIndex && typeof state.termSimilarityIndex === 'object'
						if (storeLoaded && zeroShotMin > 0 && zeroShotMin < 1) {
							const rec = state?.termSimilarityIndex?.files?.[p]
							const inferred = typeof rec?.term === 'string' ? String(rec.term).trim() : ''
							const score = Number(rec?.score ?? 0)
							if (inferred && Number.isFinite(score) && score >= zeroShotMin) {
								metaParts.push(inferred)
							}
						}
					}
				} catch {
					// ignore
				}

				let basename = getBasenameFromPath(p)
				let directory = getDirectoryFromPath(p)
				try {
					const abs = plugin.app.vault.getAbstractFileByPath(p)
					if (abs && abs instanceof TFile) {
						basename = abs.basename ?? basename
						directory = abs.parent?.path ?? directory

						const cache = plugin.app.metadataCache.getFileCache(abs) as FileCacheLike | null | undefined
						const tagsRaw = Array.isArray(cache?.tags) ? cache.tags : []
						for (const t of tagsRaw) {
							const tag = String(t?.tag ?? '').trim()
							if (tag) metaParts.push(tag)
						}
						const fm = cache?.frontmatter
						for (const a of coerceStringArray(fm?.aliases)) {
							metaParts.push(`alias:${a}`)
						}
						for (const tok of frontmatterToIndexTokens(fm)) metaParts.push(tok)
					}
				} catch {
					// ignore
				}

				const content = (summariesByPath.get(p) ?? []).join('\n')
				idx.upsert({
					id: p,
					kind: 'file',
					path: p,
					basename,
					directory,
					meta: metaParts.join(' ').trim(),
					content
				})
			} catch {
				// ignore
			}
		}
	} catch {
		// ignore
	}
}
