import type { EpochPlugin } from '../main'

type ParsedJsonResult<T = unknown> = {
	value: T | null
	salvaged: boolean
	prefixLen: number
}

type TimelineSearchCacheRuntime = EpochPlugin & {
	__timelineSearchCacheDiskLoaded?: boolean
	__timelineSearchCacheDiskPayload?: string
	__timelineSearchCacheLastPayload?: string
	__timelineSearchCacheDirty?: boolean
	__timelineSearchCacheWritePromise?: Promise<void> | null
	__timelineSearchCacheSaveTimer?: number | null
	__timelineSearchIndexVersion?: number
}

function getRuntime(plugin: EpochPlugin): TimelineSearchCacheRuntime {
	return plugin
}

function parseJsonBestEffort<T = unknown>(raw: unknown, maxPrefixLen = 64): ParsedJsonResult<T> {
	const input = (() => {
		if (typeof raw === 'string') return raw
		if (raw == null) return ''
		if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'bigint') return String(raw)
		return ''
	})()
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

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function normalizeForStableJson(value: unknown, seen: WeakMap<object, unknown>): unknown {
	if (value == null) return value
	const t = typeof value
	if (t === 'string' || t === 'number' || t === 'boolean') return value
	if (t !== 'object') return null

	const objectValue = value
	if (seen.has(objectValue)) return seen.get(objectValue) ?? null

	if (Array.isArray(value)) {
		const arr: unknown[] = []
		seen.set(value, arr)
		for (const v of value) arr.push(normalizeForStableJson(v, seen))
		return arr
	}

	const out: Record<string, unknown> = {}
	seen.set(objectValue, out)
	const record = asRecord(value)
	if (!record) return out
	const keys = Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
	for (const k of keys) {
		out[k] = normalizeForStableJson(record[k], seen)
	}
	return out
}

function stableJsonStringify(value: unknown): string {
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
		const parsed = parseJsonBestEffort<unknown>(raw, 4096)
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
	const dir = String(plugin.app.vault.configDir || '').replace(/\\/g, '/').replace(/\/+$/g, '')
	if (!dir) return CACHE_FILENAME
	return `${dir}/${CACHE_FILENAME}`
}

export async function loadTimelineSearchCache(plugin: EpochPlugin): Promise<boolean> {
	try {
		const runtime = getRuntime(plugin)
		const adapter = plugin.app.vault.adapter
		const tryLoad = async (p: string): Promise<boolean> => {
			if (!p) return false
			const exists = await adapter.exists(p)
			if (!exists) return false
			const raw = await adapter.read(p)
			if (!raw) return false
			const parsed = parseJsonBestEffort<unknown>(raw, 64)
			if (!parsed.value) return false
			let payload: unknown = parsed.value
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
				runtime.__timelineSearchCacheDiskLoaded = true
				runtime.__timelineSearchCacheDiskPayload = normalizedDisk
				runtime.__timelineSearchCacheLastPayload = normalizedDisk
				runtime.__timelineSearchCacheDirty = false
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
	const runtime = getRuntime(plugin)
	const run = async () => {
		try {
			try {
				if (runtime.__timelineSearchCacheDirty !== true) return
			} catch {
				// ignore
			}

			const p = getCachePath(plugin)
			const serialized = plugin.timelineSearchIndex.serialize()
			if (!serialized) return
			const payload = (() => {
				let value: unknown = serialized
				if (typeof value === 'string') {
					try {
						const parsed = parseJsonBestEffort<unknown>(value, 4096)
						if (parsed.value != null) value = parsed.value
					} catch {
						// ignore
					}
				}
				return stableJsonStringify(value)
			})()
			if (!payload) return

			try {
				const last = String(runtime.__timelineSearchCacheLastPayload ?? '')
				if (last && last === payload) {
					runtime.__timelineSearchCacheDirty = false
					return
				}
			} catch {
				// ignore
			}

			const adapter = plugin.app.vault.adapter
			let disk: string | null = null
			try {
				const cached = runtime.__timelineSearchCacheDiskPayload
				if (typeof cached === 'string') {
					disk = cached
				} else if (runtime.__timelineSearchCacheDiskLoaded === true) {
					disk = null
				} else {
					runtime.__timelineSearchCacheDiskLoaded = true
					if (p) {
						try {
							if (await adapter.exists(p)) {
								const rawDisk = await adapter.read(p)
								disk = typeof rawDisk === 'string' ? normalizeCachePayloadString(rawDisk) : ''
								runtime.__timelineSearchCacheDiskPayload = disk
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
					runtime.__timelineSearchCacheLastPayload = payload
					runtime.__timelineSearchCacheDirty = false
					return
				}
			} catch {
				// ignore
			}

			await adapter.write(p, payload)
			try {
				runtime.__timelineSearchCacheLastPayload = payload
				runtime.__timelineSearchCacheDiskPayload = payload
				runtime.__timelineSearchCacheDiskLoaded = true
				runtime.__timelineSearchCacheDirty = false
			} catch {
				// ignore
			}
		} catch {
			// ignore
		}
	}
	try {
		const prior: Promise<void> =
			runtime.__timelineSearchCacheWritePromise instanceof Promise
				? runtime.__timelineSearchCacheWritePromise
				: Promise.resolve()
		const next = prior.then(run, run)
		runtime.__timelineSearchCacheWritePromise = next
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
	const runtime = getRuntime(plugin)
	try {
		const prior = runtime.__timelineSearchCacheSaveTimer
		if (prior != null) {
			try {
				window.clearTimeout(prior)
			} catch {
				// ignore
			}
		}
	} catch {
		// ignore
	}
	try {
		try {
			if (runtime.__timelineSearchCacheDirty !== true) return
		} catch {
			// ignore
		}

		runtime.__timelineSearchCacheSaveTimer = window.setTimeout(() => {
			try {
				runtime.__timelineSearchCacheSaveTimer = null
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
		const runtime = getRuntime(plugin)
		runtime.__timelineSearchIndexVersion = Number(runtime.__timelineSearchIndexVersion ?? 0) + 1
	} catch {
		// ignore
	}
}

export function markTimelineSearchIndexDirty(plugin: EpochPlugin): void {
	try {
		const runtime = getRuntime(plugin)
		runtime.__timelineSearchCacheDirty = true
	} catch {
		// ignore
	}
	bumpTimelineSearchIndexVersion(plugin)
}

export async function deleteTimelineSearchCache(plugin: EpochPlugin): Promise<void> {
	try {
		const runtime = getRuntime(plugin)
		try {
			const t = runtime.__timelineSearchCacheSaveTimer
			if (t != null) {
				try {
					window.clearTimeout(t)
				} catch {
					// ignore
				}
			}
			runtime.__timelineSearchCacheSaveTimer = null
		} catch {
			// ignore
		}
		try {
			const prior = runtime.__timelineSearchCacheWritePromise
			if (prior && typeof prior.then === 'function') {
				await prior.catch(() => {})
			}
			runtime.__timelineSearchCacheWritePromise = null
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
