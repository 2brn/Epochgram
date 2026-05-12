import { TFile } from 'obsidian'
import type { EpochPlugin } from '../main'
import { frontmatterToIndexTokens } from '../utils'
import { isTopicSimilarityEnabled } from './similarity/config'

export function hydrateTimelineSearchIndexFromLoadedState(plugin: EpochPlugin): void {
	try {
		const pluginAny: any = plugin as any
		const idxAny: any = pluginAny?.timelineSearchIndex
		if (!idxAny || typeof idxAny.clear !== 'function' || typeof idxAny.upsert !== 'function') return

		idxAny.clear()

		const indexerAny: any = plugin.indexer as any
		const dateIndex: Record<string, any[]> = indexerAny?.index ?? {}

		const summariesByPath = new Map<string, string[]>()
		for (const entries of Object.values(dateIndex)) {
			if (!Array.isArray(entries) || entries.length === 0) continue
			for (const e of entries) {
				const path = String((e as any)?.file ?? '')
				if (!path || path.startsWith('epoch://')) continue
				let list = summariesByPath.get(path)
				if (!list) {
					list = []
					summariesByPath.set(path, list)
				}
				const summary = String((e as any)?.summary ?? '').trim()
				if (summary) list.push(summary)
				const aiSummary = String((e as any)?.aiSummary ?? '').trim()
				if (aiSummary) list.push(aiSummary)
			}
		}

		const paths: string[] = (() => {
			try {
				if (typeof plugin.indexer?.getIndexedPaths === 'function') {
					return plugin.indexer.getIndexedPaths()
				}
			} catch {
				// ignore
			}
			try {
				const filesAny: any = indexerAny?.files
				if (filesAny && typeof filesAny === 'object') return Object.keys(filesAny)
			} catch {
				// ignore
			}
			return []
		})()

		const coerceStringArray = (v: any): string[] => {
			if (!v) return []
			if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean)
			return [String(v).trim()].filter(Boolean)
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
					const d: any = typeof plugin.indexer?.getFileIndexData === 'function' ? plugin.indexer.getFileIndexData(p) : null
					const reviewState = String(d?.reviewState ?? '').trim()
					if (reviewState) metaParts.push(`review:${reviewState}`)
					const markColor = d?.markColor
					if (typeof markColor === 'number' && Number.isFinite(markColor)) metaParts.push(`mark:${markColor}`)
					if (d?.pinnedFile === true) metaParts.push('pinned')
				} catch {
					// ignore
				}

				try {
					if (typeof plugin.indexer?.getFileEmbeddingTerm === 'function') {
						const term = String(plugin.indexer.getFileEmbeddingTerm(p) || '').trim()
						if (term) metaParts.push(term)
					}
				} catch {
					// ignore
				}

				try {
					if (isTopicSimilarityEnabled(plugin)) {
						const zeroShotMinRaw = Number(pluginAny?.settings?.similarityZeroShotMinScore ?? 0)
						const zeroShotMin = Number.isFinite(zeroShotMinRaw) ? Math.max(0, Math.min(1, zeroShotMinRaw)) : 0
						const storeLoaded = pluginAny?.termSimilarityLoaded === true && !!pluginAny?.termSimilarityIndex && typeof pluginAny.termSimilarityIndex === 'object'
						if (storeLoaded && zeroShotMin > 0 && zeroShotMin < 1) {
							const rec: any = pluginAny?.termSimilarityIndex?.files?.[p]
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
					const abs: any = plugin.app.vault.getAbstractFileByPath(p)
					if (abs && abs instanceof TFile) {
						basename = abs.basename ?? basename
						directory = abs.parent?.path ?? directory

						const cache: any = plugin.app.metadataCache.getFileCache(abs)
						const tagsRaw: any[] = Array.isArray(cache?.tags) ? cache.tags : []
						for (const t of tagsRaw) {
							const tag = String((t as any)?.tag ?? '').trim()
							if (tag) metaParts.push(tag)
						}
						const fm: any = cache?.frontmatter
						for (const a of coerceStringArray(fm?.aliases ?? fm?.alias)) {
							metaParts.push(`alias:${a}`)
						}
						for (const tok of frontmatterToIndexTokens(fm)) metaParts.push(tok)
					}
				} catch {
					// ignore
				}

				const content = (summariesByPath.get(p) ?? []).join('\n')
				idxAny.upsert({
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
