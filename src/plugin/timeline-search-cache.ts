import type { EpochPlugin } from '../main'

type ParsedJsonResult<T = any> = {
	value: T | null
	salvaged: boolean
	prefixLen: number
}

function parseJsonBestEffort<T = any>(raw: string, maxPrefixLen = 64): ParsedJsonResult<T> {
	const input = typeof raw === 'string' ? raw : String(raw ?? '')
	if (!input) return { value: null, salvaged: false, prefixLen: 0 }

	let s = input
	try {
		s = s.replace(/^\uFEFF/, '')
	} catch {
		// ignore
	}

	const trimmed = (() => {
		try {
			return s.trimStart()
		} catch {
			return s
		}
	})()

	try {
		return { value: JSON.parse(trimmed) as T, salvaged: trimmed !== input, prefixLen: 0 }
	} catch {
		// ignore
	}

	try {
		const m = trimmed.match(/[[{]/)
		const idx = m ? trimmed.indexOf(m[0]) : -1
		if (idx > 0 && idx <= Math.max(0, Number(maxPrefixLen) || 0)) {
			const candidate = trimmed.slice(idx)
			return { value: JSON.parse(candidate) as T, salvaged: true, prefixLen: idx }
		}
	} catch {
		// ignore
	}

	return { value: null, salvaged: false, prefixLen: 0 }
}

const CACHE_FILENAME = 'epochgram-search.json'

function normalizeForStableJson(value: any, seen: WeakMap<object, any>): any {
	if (value == null) return value
	const t = typeof value
	if (t === 'string' || t === 'number' || t === 'boolean') return value
	if (t !== 'object') return null

	if (seen.has(value)) return seen.get(value)

	if (Array.isArray(value)) {
		const arr: any[] = []
		seen.set(value, arr)
		for (const v of value) arr.push(normalizeForStableJson(v, seen))
		return arr
	}

	const out: Record<string, any> = {}
	seen.set(value, out)
	const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
	for (const k of keys) {
		out[k] = normalizeForStableJson((value as any)[k], seen)
	}
	return out
}

function stableJsonStringify(value: any): string {
	try {
		const normalized = normalizeForStableJson(value, new WeakMap())
		return JSON.stringify(normalized)
	} catch {
		try {
			return JSON.stringify(value)
		} catch {
			return ''
		}
	}
}

function normalizeCachePayloadString(raw: string): string {
	try {
		const parsed = parseJsonBestEffort<any>(raw, 4096)
		if (parsed.value != null) return stableJsonStringify(parsed.value)
	} catch {
		// ignore
	}
	try {
		return String(raw ?? '').replace(/^\uFEFF/, '').trim()
	} catch {
		return ''
	}
}

function getCachePath(plugin: EpochPlugin): string {
	const dir = String((plugin as any)?.app?.vault?.configDir || '').replace(/\\/g, '/').replace(/\/+$/g, '')
	if (!dir) return CACHE_FILENAME
	return `${dir}/${CACHE_FILENAME}`
}

export async function loadTimelineSearchCache(plugin: EpochPlugin): Promise<boolean> {
	try {
		const anyPlugin: any = plugin as any
		const adapter = plugin.app.vault.adapter
		const tryLoad = async (p: string): Promise<boolean> => {
			if (!p) return false
			const exists = await adapter.exists(p)
			if (!exists) return false
			const raw = await adapter.read(p)
			if (!raw) return false
			const parsed = parseJsonBestEffort<any>(raw, 64)
			if (!parsed.value) return false
			let payload: any = parsed.value
			if (typeof payload === 'string') {
				try {
					payload = JSON.parse(payload)
				} catch {
					// ignore
				}
			}
			const ok = plugin.timelineSearchIndex.loadSerialized(payload)
			if (!ok) {
				// If the cache is structurally incompatible/corrupted, delete it so the next rebuild
				// can persist a clean cache instead of failing to hydrate every startup.
				try {
					await adapter.remove(p)
				} catch {
					// ignore
				}
			}
			try {
				const normalizedDisk = typeof raw === 'string' ? normalizeCachePayloadString(raw) : ''
				anyPlugin.__timelineSearchCacheDiskLoaded = true
				anyPlugin.__timelineSearchCacheDiskPayload = normalizedDisk
				anyPlugin.__timelineSearchCacheLastPayload = normalizedDisk
				anyPlugin.__timelineSearchCacheDirty = false
			} catch {
				// ignore
			}
			return ok
		}
		const primary = getCachePath(plugin)
		return await tryLoad(primary)
	} catch {
		return false
	}
}

export async function saveTimelineSearchCache(plugin: EpochPlugin): Promise<void> {
	const anyPlugin: any = plugin as any
	const run = async () => {
		try {
			try {
				if (anyPlugin.__timelineSearchCacheDirty !== true) return
			} catch {
				// ignore
			}

			const p = getCachePath(plugin)
			const serialized = plugin.timelineSearchIndex.serialize()
			if (!serialized) return
			const payload = (() => {
				let value: any = serialized
				if (typeof value === 'string') {
					try {
						const parsed = parseJsonBestEffort<any>(value, 4096)
						if (parsed.value != null) value = parsed.value
					} catch {
						// ignore
					}
				}
				return stableJsonStringify(value)
			})()
			if (!payload) return

			try {
				const last = String(anyPlugin.__timelineSearchCacheLastPayload ?? '')
				if (last && last === payload) {
					anyPlugin.__timelineSearchCacheDirty = false
					return
				}
			} catch {
				// ignore
			}

			const adapter = plugin.app.vault.adapter
			let disk: string | null = null
			try {
				const cached = anyPlugin.__timelineSearchCacheDiskPayload
				if (typeof cached === 'string') {
					disk = cached
				} else if (anyPlugin.__timelineSearchCacheDiskLoaded === true) {
					disk = null
				} else {
					anyPlugin.__timelineSearchCacheDiskLoaded = true
					if (p) {
						try {
							if (await adapter.exists(p)) {
								const rawDisk = await adapter.read(p)
								disk = typeof rawDisk === 'string' ? normalizeCachePayloadString(rawDisk) : ''
								anyPlugin.__timelineSearchCacheDiskPayload = disk
							}
						} catch {
							// ignore
						}
					}
				}
			} catch {
				// ignore
			}

			try {
				if (typeof disk === 'string' && disk === payload) {
					anyPlugin.__timelineSearchCacheLastPayload = payload
					anyPlugin.__timelineSearchCacheDirty = false
					return
				}
			} catch {
				// ignore
			}

			await adapter.write(p, payload)
			try {
				anyPlugin.__timelineSearchCacheLastPayload = payload
				anyPlugin.__timelineSearchCacheDiskPayload = payload
				anyPlugin.__timelineSearchCacheDiskLoaded = true
				anyPlugin.__timelineSearchCacheDirty = false
			} catch {
				// ignore
			}
		} catch {
			// ignore
		}
	}
	try {
		const prior: Promise<void> =
			anyPlugin.__timelineSearchCacheWritePromise instanceof Promise
				? anyPlugin.__timelineSearchCacheWritePromise
				: Promise.resolve()
		const next = prior.then(run, run)
		anyPlugin.__timelineSearchCacheWritePromise = next
		await next
	} catch {
		try {
			await run()
		} catch {
			// ignore
		}
	}
}

export function scheduleTimelineSearchCacheSave(plugin: EpochPlugin, delayMs = 1000): void {
	const anyPlugin: any = plugin as any
	try {
		const prior = anyPlugin.__timelineSearchCacheSaveTimer as any
		if (prior != null) {
			try {
				;(window as any).clearTimeout?.(prior)
			} catch {
				// ignore
			}
		}
	} catch {
		// ignore
	}
	try {
		try {
			if (anyPlugin.__timelineSearchCacheDirty !== true) return
		} catch {
			// ignore
		}

		anyPlugin.__timelineSearchCacheSaveTimer = (window as any).setTimeout?.(() => {
			try {
				anyPlugin.__timelineSearchCacheSaveTimer = null
			} catch {
				// ignore
			}
			try {
				void saveTimelineSearchCache(plugin)
			} catch {
				// ignore
			}
		}, Math.max(0, Number(delayMs) || 0))
	} catch {
		// ignore
	}
}

export function bumpTimelineSearchIndexVersion(plugin: EpochPlugin): void {
	try {
		const anyPlugin: any = plugin as any
		anyPlugin.__timelineSearchIndexVersion = Number(anyPlugin.__timelineSearchIndexVersion ?? 0) + 1
	} catch {
		// ignore
	}
}

export function markTimelineSearchIndexDirty(plugin: EpochPlugin): void {
	try {
		const anyPlugin: any = plugin as any
		anyPlugin.__timelineSearchCacheDirty = true
	} catch {
		// ignore
	}
	bumpTimelineSearchIndexVersion(plugin)
}

export async function deleteTimelineSearchCache(plugin: EpochPlugin): Promise<void> {
	try {
		try {
			const anyPlugin: any = plugin as any
			const t: any = anyPlugin.__timelineSearchCacheSaveTimer
			if (t != null) {
				try {
					;(window as any).clearTimeout?.(t)
				} catch {
					// ignore
				}
			}
			anyPlugin.__timelineSearchCacheSaveTimer = null
		} catch {
			// ignore
		}
		try {
			const anyPlugin: any = plugin as any
			const prior: any = anyPlugin.__timelineSearchCacheWritePromise
			if (prior && typeof prior.then === 'function') {
				await prior.catch?.(() => {})
			}
			anyPlugin.__timelineSearchCacheWritePromise = null
		} catch {
			// ignore
		}
		const adapter = plugin.app.vault.adapter
		const p = getCachePath(plugin)
		if (p) {
			try {
				const exists = await adapter.exists(p)
				if (exists) {
					await adapter.remove(p)
				}
			} catch {
				// ignore
			}
		}
	} catch {
		// ignore
	}
}
