import { Notice, Platform, TFile } from 'obsidian'
import type { EpochPlugin } from '../main'
import { normalizeSnapshotValue } from '../indexer/snapshot-helpers'
import { frontmatterToIndexTokens, isLikelyTextFileExtension, stripYamlFrontmatterBlock } from '../utils'
import { deleteTimelineSearchCache, markTimelineSearchIndexDirty, saveTimelineSearchCache } from './timeline-search-cache'
import { clearEpochProgress, consumeCancelRequested, setEpochProgress } from './progress'
import { isUserEditingMarkdown } from './notice-utils'
import { isTopicSimilarityEnabled } from './similarity/config'

export interface SearchMethods {
	rebuildTimelineSearchIndex(): Promise<void>
	resetTimelineSearchIndex(): void
}

export const searchMethods: SearchMethods = {
	async rebuildTimelineSearchIndex(this: EpochPlugin): Promise<void> {
			const anyThis: any = this as any
			try {
				if (typeof anyThis.timelineSearchRebuildStartedAt !== 'number' || !(anyThis.timelineSearchRebuildStartedAt > 0)) {
					anyThis.timelineSearchRebuildStartedAt = Date.now()
				}
			} catch {
				// ignore
			}

			const shouldShowSearchProgressNotice = (): boolean => {
				try {
					const last = typeof anyThis.lastTimelineSearchProgressNoticeAt === 'number' ? anyThis.lastTimelineSearchProgressNoticeAt : 0
					const minMs = Platform.isMobileApp ? 10000 : 1000
					if (Date.now() - last < minMs) return false
					anyThis.lastTimelineSearchProgressNoticeAt = Date.now()
					return true
				} catch {
					return true
				}
			}

			const shouldAllowSearchProgressNotice = (): boolean => {
				try {
					const startedAt = Number(anyThis?.timelineSearchRebuildStartedAt ?? 0)
					if (!(Number.isFinite(startedAt) && startedAt > 0)) return true
					const graceMs = Platform.isMobileApp ? 10000 : 1000
					return Date.now() - startedAt >= graceMs
				} catch {
					return true
				}
			}

			const maybeShowProgress = (scanned: number, total: number) => {
				try {
					if (!shouldShowSearchProgressNotice()) return
					if (!shouldAllowSearchProgressNotice()) return
					if (isUserEditingMarkdown(this.app)) return
						const msgDesktop = `Search… ${scanned}/${Math.max(scanned, total)}`
					if (Platform.isDesktopApp) {
						setEpochProgress(this, 'search', msgDesktop)
					} else {
							new Notice(`Search… ${scanned}/${Math.max(scanned, total)}`, 900)
					}
				} catch {
					// ignore
				}
			}

			const isCancelledError = (e: any): boolean => {
				try {
					return String(e?.code || '') === 'EPOCH_CANCELLED' || String(e?.message || '') === 'EPOCH_CANCELLED'
				} catch {
					return false
				}
			}

			try {

		try {
			await this.ensureIndexLoaded()
			await this.waitForExcludedSync()
		} catch {
			// ignore
		}

		try {
			this.timelineSearchIndex?.clear?.()
		} catch {
			// ignore
		}

		const paths: string[] = (() => {
			try {
				if (typeof this.indexer?.getIndexedPaths === 'function') {
					return this.indexer.getIndexedPaths()
				}
			} catch {
				// ignore
			}
			try {
				const filesAny: any = (this.indexer as any)?.files
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

			let scanned = 0
			const total = paths.length
			for (const path of paths) {
				scanned++
				if (Platform.isDesktopApp) {
					try {
						if (consumeCancelRequested(this, 'search')) {
							throw Object.assign(new Error('EPOCH_CANCELLED'), { code: 'EPOCH_CANCELLED' })
						}
					} catch (e: any) {
						const msg = String(e?.message || '')
						if (msg === 'EPOCH_CANCELLED') throw e
					}
				}
				maybeShowProgress(scanned, total)

			const p = String(path || '')
			if (!p || p.startsWith('epoch://')) continue

			const abs = this.app.vault.getAbstractFileByPath(p)
			if (!(abs instanceof TFile)) continue
			if (!this.shouldIndexFile(abs)) continue

			const isEpochgramExportHtml = (() => {
				try {
					const ext = String(abs.extension || '').toLowerCase()
					if (ext !== 'html' && ext !== 'htm') return false
					const base = String(abs.basename || '').toLowerCase()
					return base.startsWith('epochgram-')
				} catch {
					return false
				}
			})()

			let content = ''
			try {
				if (isLikelyTextFileExtension(abs.extension) && !isEpochgramExportHtml) {
					const raw = await this.app.vault.read(abs)
					content = stripYamlFrontmatterBlock(String(normalizeSnapshotValue(raw) ?? ''))
				}
			} catch {
				content = ''
			}

			const metaParts: string[] = []
			metaParts.push(`ext:${String(abs.extension || '')}`)
			try {
				const d: any = typeof this.indexer?.getFileIndexData === 'function' ? this.indexer.getFileIndexData(p) : null
				const reviewState = String(d?.reviewState ?? '').trim()
				if (reviewState) metaParts.push(`review:${reviewState}`)
				const markColor = d?.markColor
				if (typeof markColor === 'number' && Number.isFinite(markColor)) metaParts.push(`mark:${markColor}`)
				if (d?.pinnedFile === true) metaParts.push('pinned')
			} catch {
				// ignore
			}
			try {
				if (typeof this.indexer?.getFileEmbeddingTerm === 'function') {
					const term = String(this.indexer.getFileEmbeddingTerm(p) || '').trim()
					if (term) metaParts.push(term)
				}
			} catch {
				// ignore
			}
			try {
				const pluginAny: any = this as any
				if (isTopicSimilarityEnabled(pluginAny)) {
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
			try {
				const cache: any = this.app.metadataCache.getFileCache(abs)
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
			} catch {
				// ignore
			}

			try {
				this.timelineSearchIndex.upsert({
					id: p,
					kind: 'file',
					path: p,
					basename: abs.basename ?? '',
					directory: abs.parent?.path ?? '',
					content,
					meta: metaParts.join(' ').trim()
				})
			} catch {
				// ignore
			}
		}

		try {
			markTimelineSearchIndexDirty(this)
		} catch {
			// ignore
		}
		try {
			await saveTimelineSearchCache(this)
		} catch {
			// ignore
		}

		try {
			// If a timeline search query is active, request the view to refocus the first matching
			// record after rebuild (same behavior as pressing Enter in the search modal).
			const anyThis: any = this as any
			anyThis.__epochTimelineSearchFocusToken = Number(anyThis.__epochTimelineSearchFocusToken ?? 0) + 1
		} catch {
			// ignore
		}

			try {
				this.refreshEpochViews()
			} catch {
				// ignore
			}
			try {
				new Notice('Epochgram: Search index rebuilt', 1500)
			} catch {
				// ignore
			}
		} catch (e) {
			if (isCancelledError(e)) {
				try {
					new Notice('Canceled', 2500)
				} catch {
					// ignore
				}
				return
			}
			throw e
		} finally {
			try {
				if (Platform.isDesktopApp) {
					clearEpochProgress(this, 'search', 1500)
				}
			} catch {
				// ignore
			}
			try {
				delete (this as any)?.timelineSearchRebuildStartedAt
			} catch {
				// ignore
			}
			try {
				delete (this as any)?.__epochCancelRequestedAt?.search
			} catch {
				// ignore
			}
		}
	},

	resetTimelineSearchIndex(this: EpochPlugin): void {
		try {
			this.timelineSearchIndex?.clear?.()
		} catch {
			// ignore
		}
		try {
			void deleteTimelineSearchCache(this)
		} catch {
			// ignore
		}

		try {
			const anyThis: any = this as any
			anyThis.__timelineSearchIndexVersion = Number(anyThis.__timelineSearchIndexVersion ?? 0) + 1
		} catch {
			// ignore
		}

		try {
			this.refreshEpochViews()
		} catch {
			// ignore
		}
		try {
			new Notice('Epochgram: Search index reset', 1500)
		} catch {
			// ignore
		}
	}
}
