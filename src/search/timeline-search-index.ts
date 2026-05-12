import MiniSearch, { type Query, type QueryCombination, type SearchResult } from 'minisearch'

type TimelineSearchDoc = {
	id: string
	kind: 'file'
	path: string
	basename: string
	directory: string
	content: string
	meta: string
}

function normalizeDiacritics(text: string): string {
	const s = String(text || '')
	try {
		// Prefer Unicode normalization when available.
		return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
	} catch {
		return s.replace(/[\u0300-\u036f]/g, '')
	}
}

function normalizeTextForIncludes(text: string): string {
	return normalizeDiacritics(String(text || ''))
		.toLowerCase()
		.replace(/[\\/_.:\-\u2010-\u2015\u2212]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

function splitCamelCase(token: string): string[] {
	const t = String(token || '')
	if (!t) return []
	// Split boundaries like: fooBar, FOOBar, foo2Bar, fooBARBaz
	const parts = t
		.replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2')
		.replace(/([\p{Lu}]+)([\p{Lu}][\p{Ll}])/gu, '$1 $2')
		.replace(/([\p{L}])([\p{N}])/gu, '$1 $2')
		.replace(/([\p{N}])([\p{L}])/gu, '$1 $2')
		.split(/\s+/g)
		.map((x) => String(x || '').trim())
		.filter(Boolean)
	return parts
}

function tokenizeText(text: string): string[] {
	const raw = String(text || '')
	if (!raw) return []

	// Treat common separators (including path separators) as whitespace.
	const normalized = raw.replace(/[\\/_.:\-\u2010-\u2015\u2212]+/g, ' ')
	const baseTokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
	if (baseTokens.length === 0) return []

	const out: string[] = []
	const seen = new Set<string>()

	const push = (tok: string) => {
		const t = String(tok || '').trim()
		if (!t) return
		// Keep 1-char numeric tokens (e.g. "1"), but drop most 1-char alpha tokens.
		if (t.length === 1 && !/^[0-9]$/u.test(t)) return
		if (seen.has(t)) return
		seen.add(t)
		out.push(t)
	}

	for (const tok of baseTokens) {
		push(tok)
		for (const p of splitCamelCase(tok)) push(p)
	}

	return out
}

function tokenizeWordsForSearch(text: string): string[] {
	const raw = String(text || '').trim()
	if (!raw) return []
	// Keep this intentionally light, but strip the same common separators that the index treats as whitespace.
	// This avoids mismatches like searching `Rawdat A.` (unquoted) requiring a 1-char token that is never indexed.
	const normalized = raw.replace(/[\\/_.:\-\u2010-\u2015\u2212]+/g, ' ')
	return normalized
		.split(/[\s[\]{}()<>]+/g)
		.map((t) => String(t || '').trim())
		.filter(Boolean)
}

function isAllowedSearchToken(token: string): boolean {
	const t = String(token || '').trim()
	if (!t) return false
	// Match index tokenization: keep 1-char numeric tokens (e.g. "1"), but drop most 1-char alpha tokens.
	if (t.length === 1 && !/^[0-9]$/u.test(t)) return false
	return true
}

function tokenizeTokensForSearch(text: string): string[] {
	const raw = String(text || '')
	if (!raw) return []
	// Match indexing's fundamental token extraction (letters + numbers), after normalizing common separators.
	const normalized = raw.replace(/[\\/_.:\-\u2010-\u2015\u2212]+/g, ' ')
	return normalized.match(/[\p{L}\p{N}]+/gu) ?? []
}

function buildQuery(text: string): QueryCombination {
	const tokens = tokenizeTokensForSearch(text).filter(isAllowedSearchToken)
	const words = tokenizeWordsForSearch(text).filter(isAllowedSearchToken)

	const camelFromTokens = tokens.flatMap(splitCamelCase).filter(isAllowedSearchToken)
	const camelFromWords = words.flatMap(splitCamelCase).filter(isAllowedSearchToken)

	const unique = (arr: string[]) => {
		const out: string[] = []
		const seen = new Set<string>()
		for (const v of arr) {
			const s = String(v || '').trim()
			if (!isAllowedSearchToken(s)) continue
			if (seen.has(s)) continue
			seen.add(s)
			out.push(s)
		}
		return out
	}

	return {
		combineWith: 'OR',
		queries: [
			{ combineWith: 'AND', queries: unique(tokens) },
			{ combineWith: 'AND', queries: unique(words) },
			{ combineWith: 'AND', queries: unique(camelFromTokens) },
			{ combineWith: 'AND', queries: unique(camelFromWords) }
		]
	}
}

function getSearchOptionsForText(_text: string): { prefix: (term: string) => boolean; fuzzy: (term: string) => number } {
	// Default fuzziness behavior:
	// - length <= 3: no fuzziness
	// - length <= 5: 10% fuzziness
	// - length > 5: 20% fuzziness
	const fuzziness = 0.2
	const prefixMinLen = 3

	return {
		prefix: (term) => term.length >= prefixMinLen,
		fuzzy: (term) => (term.length <= 3 ? 0 : term.length <= 5 ? fuzziness / 2 : fuzziness)
	}
}

export class TimelineSearchIndex {
	private mini: MiniSearch<TimelineSearchDoc>
	private initialized = false
	private getMiniSearchCtor(): any {
		const anyMini: any = MiniSearch as any
		return anyMini?.default ?? anyMini
	}
	private getMiniSearchStatic(name: string): any {
		try {
			const ctor: any = this.getMiniSearchCtor()
			if (ctor && typeof ctor[name] !== 'undefined') return ctor[name]
		} catch {
			// ignore
		}
		try {
			const anyMini: any = MiniSearch as any
			if (anyMini && typeof anyMini[name] !== 'undefined') return anyMini[name]
		} catch {
			// ignore
		}
		return undefined
	}
	private createMini(): MiniSearch<TimelineSearchDoc> {
		return new MiniSearch<TimelineSearchDoc>({
			fields: ['path', 'basename', 'directory', 'meta', 'content'],
			storeFields: ['kind', 'path', 'basename', 'directory', 'meta', 'content'],
			autoVacuum: false,
			tokenize: (text) => tokenizeText(text),
			processTerm: (term) => normalizeTextForIncludes(term),
			searchOptions: {
				combineWith: 'AND'
			}
		})
	}

	constructor() {
		this.mini = this.createMini()
		this.initialized = true
	}

	clear() {
		this.mini = this.createMini()
		this.initialized = true
	}

	serialize(): unknown {
		if (!this.initialized) this.clear()
		try {
			return (this.mini as any).toJSON?.() ?? null
		} catch {
			return null
		}
	}

	loadSerialized(serialized: unknown): boolean {
		try {
			if (!serialized) return false
			const ctor: any = this.getMiniSearchCtor()
			const loadJSON: any = ctor?.loadJSON ?? this.getMiniSearchStatic('loadJSON')
			if (typeof loadJSON !== 'function') return false
			const json = typeof serialized === 'string' ? serialized : JSON.stringify(serialized)
			const loaded: any = loadJSON.call(ctor ?? MiniSearch, json, {
				fields: ['path', 'basename', 'directory', 'meta', 'content'],
				storeFields: ['kind', 'path', 'basename', 'directory', 'meta', 'content'],
				autoVacuum: false,
				tokenize: (text: string) => tokenizeText(text),
				processTerm: (term: string) => normalizeTextForIncludes(term),
				searchOptions: { combineWith: 'AND' }
			})
			if (!loaded) return false
			if (typeof loaded.add !== 'function' || typeof loaded.search !== 'function' || typeof loaded.getStoredFields !== 'function') {
				return false
			}
			this.mini = loaded as MiniSearch<TimelineSearchDoc>
			this.initialized = true
			return true
		} catch {
			return false
		}
	}

	upsert(doc: TimelineSearchDoc): boolean {
		if (!this.initialized) this.clear()
		try {
			const existing = this.mini.getStoredFields(doc.id) as any
			if (existing) {
				const same =
					String(existing.kind ?? '') === String(doc.kind ?? '') &&
					String(existing.path ?? '') === String(doc.path ?? '') &&
					String(existing.basename ?? '') === String(doc.basename ?? '') &&
					String(existing.directory ?? '') === String(doc.directory ?? '') &&
					String(existing.meta ?? '') === String(doc.meta ?? '') &&
					String(existing.content ?? '') === String(doc.content ?? '')
				if (same) return false
				this.mini.remove({ id: doc.id, ...existing } as TimelineSearchDoc)
				this.mini.add(doc)
				return true
			}
			this.mini.add(doc)
			return true
		} catch {
			try {
				this.clear()
				this.mini.add(doc)
				return true
			} catch {
				return false
			}
		}
	}

	removeById(id: string): boolean {
		if (!this.initialized) this.clear()
		try {
			const stored = this.mini.getStoredFields(id) as any
			if (stored) {
				this.mini.remove({ id, ...stored } as TimelineSearchDoc)
				return true
			}
		} catch {
			// ignore
		}
		return false
	}

	searchFileIds(options: {
		includeText: string
		exactPhrases: string[]
		excludedPhrases: string[]
		excludeTokens: string[]
	}): Set<string> {
		if (!this.initialized) this.clear()
		const includeText = String(options.includeText || '').trim()
		const exactPhrases = (options.exactPhrases ?? []).map((t) => String(t || '').trim()).filter(Boolean)
		const excludedPhrases = (options.excludedPhrases ?? []).map((t) => String(t || '').trim()).filter(Boolean)
		const excludeTokens = (options.excludeTokens ?? []).map((t) => String(t || '').trim()).filter(Boolean)
		if (!includeText && exactPhrases.length === 0 && excludedPhrases.length === 0 && excludeTokens.length === 0) {
			return new Set()
		}
		const opts = getSearchOptionsForText(includeText || exactPhrases.join(' '))

		let query: Query
		if (includeText) {
			query = buildQuery(includeText)
		} else {
			const wildcard = this.getMiniSearchStatic('wildcard')
			query = typeof wildcard !== 'undefined' ? wildcard : ('' as any)
		}

		if (excludeTokens.length > 0) {
			query = {
				combineWith: 'AND_NOT',
				queries: [query, ...excludeTokens]
			}
		}

		const filterFile = (result: any): boolean => {
			try {
				return result?.kind === 'file'
			} catch {
				return true
			}
		}

		const exactNeedles = exactPhrases.map((p) => normalizeTextForIncludes(p)).filter(Boolean)
		const excludedNeedles = excludedPhrases.map((p) => normalizeTextForIncludes(p)).filter(Boolean)

		const matchesPostFilter = (r: any): boolean => {
			const hay = normalizeTextForIncludes(
				[String(r?.path ?? ''), String(r?.basename ?? ''), String(r?.directory ?? ''), String(r?.meta ?? ''), String(r?.content ?? '')].join('\n')
			)
			if (!hay) return false

			for (const ex of excludedNeedles) {
				if (ex && hay.includes(ex)) return false
			}
			for (const p of exactNeedles) {
				if (p && !hay.includes(p)) return false
			}
			return true
		}

		const runSearch = (fuzzy: (term: string) => number): SearchResult[] => {
			return this.mini.search(query, {
				// Query is already tokenized (QueryCombination), don't tokenize again.
				tokenize: (text) => [text],
				prefix: opts.prefix,
				fuzzy,
				filter: filterFile
			})
		}

		let results: SearchResult[] = []
		try {
			results = runSearch(opts.fuzzy)
		} catch {
			results = []
		}

		const ids = new Set<string>()
		for (const r of results as any[]) {
			const id = String(r?.id ?? '')
			if (!id) continue
			if (!matchesPostFilter(r)) continue
			ids.add(id)
		}
		return ids
	}

	searchFileIdsRanked(options: {
		includeText: string
		exactPhrases: string[]
		excludedPhrases: string[]
		excludeTokens: string[]
	}): string[] {
		if (!this.initialized) this.clear()
		const includeText = String(options.includeText || '').trim()
		const exactPhrases = (options.exactPhrases ?? []).map((t) => String(t || '').trim()).filter(Boolean)
		const excludedPhrases = (options.excludedPhrases ?? []).map((t) => String(t || '').trim()).filter(Boolean)
		const excludeTokens = (options.excludeTokens ?? []).map((t) => String(t || '').trim()).filter(Boolean)
		if (!includeText && exactPhrases.length === 0 && excludedPhrases.length === 0 && excludeTokens.length === 0) {
			return []
		}
		const opts = getSearchOptionsForText(includeText || exactPhrases.join(' '))

		let query: Query
		if (includeText) {
			query = buildQuery(includeText)
		} else {
			const wildcard = this.getMiniSearchStatic('wildcard')
			query = typeof wildcard !== 'undefined' ? wildcard : ('' as any)
		}

		if (excludeTokens.length > 0) {
			query = {
				combineWith: 'AND_NOT',
				queries: [query, ...excludeTokens]
			}
		}

		const filterFile = (result: any): boolean => {
			try {
				return result?.kind === 'file'
			} catch {
				return true
			}
		}

		const exactNeedles = exactPhrases.map((p) => normalizeTextForIncludes(p)).filter(Boolean)
		const excludedNeedles = excludedPhrases.map((p) => normalizeTextForIncludes(p)).filter(Boolean)

		const matchesPostFilter = (r: any): boolean => {
			const hay = normalizeTextForIncludes(
				[String(r?.path ?? ''), String(r?.basename ?? ''), String(r?.directory ?? ''), String(r?.meta ?? ''), String(r?.content ?? '')].join('\n')
			)
			if (!hay) return false
			for (const ex of excludedNeedles) {
				if (ex && hay.includes(ex)) return false
			}
			for (const p of exactNeedles) {
				if (p && !hay.includes(p)) return false
			}
			return true
		}

		const runSearch = (fuzzy: (term: string) => number): SearchResult[] => {
			return this.mini.search(query, {
				// Query is already tokenized (QueryCombination), don't tokenize again.
				tokenize: (text) => [text],
				prefix: opts.prefix,
				fuzzy,
				filter: filterFile
			})
		}

		let results: SearchResult[] = []
		try {
			results = runSearch(opts.fuzzy)
		} catch {
			results = []
		}

		const out: string[] = []
		const seen = new Set<string>()
		for (const r of results as any[]) {
			const id = String(r?.id ?? '')
			if (!id) continue
			if (seen.has(id)) continue
			if (!matchesPostFilter(r)) continue
			seen.add(id)
			out.push(id)
		}
		return out
	}
}
