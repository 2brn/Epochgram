type NodeDetectionMaskSnapshot = {
	originalGlobalProcess: unknown;
	hidGlobalProcess: boolean;
	mutatedNodeVersion: boolean;
	originalNodeVersion: unknown;
	deletedNodeVersion: boolean;
	mutatedReleaseName: boolean;
	originalReleaseName: unknown;
	deletedReleaseName: boolean;
};

type MutableRecord = Record<string, unknown>;

function asRecord(value: unknown): MutableRecord | null {
	return typeof value === "object" && value !== null ? (value as MutableRecord) : null;
}

export function detectNodeLikeEnvironment(g: unknown): boolean {
	try {
		const p = asRecord(g)?.process;
		const pRecord = asRecord(p);
		const versions = asRecord(pRecord?.versions);
		const nodeVersion = versions?.node;
		return (
			typeof p === "object" &&
			p !== null &&
			typeof versions === "object" &&
			versions !== null &&
			typeof nodeVersion === "string"
		);
	} catch {
		return false;
	}
}

function trySet(obj: MutableRecord, key: string, value: unknown): boolean {
	try {
		obj[key] = value;
		return true;
	} catch {
		return false;
	}
}

function tryDelete(obj: MutableRecord, key: string): boolean {
	try {
		return delete obj[key];
	} catch {
		return false;
	}
}

function tryDefineValue(obj: MutableRecord, key: string, value: unknown): boolean {
	try {
		Object.defineProperty(obj, key, {
			value,
			writable: true,
			configurable: true,
			enumerable: true
		});
		return true;
	} catch {
		return false;
	}
}

export function maskNodeDetectionForBrowserLibraries(g: unknown): NodeDetectionMaskSnapshot {
	const gRecord = asRecord(g);
	const snapshot: NodeDetectionMaskSnapshot = {
		originalGlobalProcess: undefined,
		hidGlobalProcess: false,
		mutatedNodeVersion: false,
		originalNodeVersion: undefined,
		deletedNodeVersion: false,
		mutatedReleaseName: false,
		originalReleaseName: undefined,
		deletedReleaseName: false
	};

	snapshot.originalGlobalProcess = gRecord?.process;

	const p = asRecord(gRecord?.process);
	// Prefer mutating the existing process object so `typeof process === 'object'` stays true
	// but `process.versions.node` is no longer a string.
	try {
		if (p) {
			const versions = asRecord(p.versions);
			if (versions) {
				if ("node" in versions) {
					snapshot.originalNodeVersion = versions.node;
					if (trySet(versions, "node", undefined)) snapshot.mutatedNodeVersion = true;
					else if (tryDefineValue(versions, "node", undefined)) snapshot.mutatedNodeVersion = true;
					else if (tryDelete(versions, "node")) snapshot.deletedNodeVersion = true;
				}
			}

			const release = asRecord(p.release);
			if (release) {
				if ("name" in release) {
					snapshot.originalReleaseName = release.name;
					if (trySet(release, "name", "")) snapshot.mutatedReleaseName = true;
					else if (tryDefineValue(release, "name", "")) snapshot.mutatedReleaseName = true;
					else if (tryDelete(release, "name")) snapshot.deletedReleaseName = true;
				}
			}
		}
	} catch {
		// ignore
	}

	// If we still look Node-like, hide process globally as a last resort.
	if (detectNodeLikeEnvironment(g)) {
		try {
			if (gRecord) {
				if (trySet(gRecord, "process", undefined)) snapshot.hidGlobalProcess = true;
				else if (tryDefineValue(gRecord, "process", undefined)) snapshot.hidGlobalProcess = true;
				else if (tryDelete(gRecord, "process")) snapshot.hidGlobalProcess = true;
			}
		} catch {
			// ignore
		}
	}

	return snapshot;
}

export function restoreNodeDetectionMask(g: unknown, snapshot: NodeDetectionMaskSnapshot): void {
	try {
		const gRecord = asRecord(g);
		if (snapshot.hidGlobalProcess) {
			if (gRecord) {
				trySet(gRecord, "process", snapshot.originalGlobalProcess);
				tryDefineValue(gRecord, "process", snapshot.originalGlobalProcess);
			}
		}

		const p = asRecord(snapshot.originalGlobalProcess);
		if (p) {
			const versions = asRecord(p.versions);
			if (versions) {
				if (snapshot.mutatedNodeVersion) {
					trySet(versions, "node", snapshot.originalNodeVersion);
				}
				if (snapshot.deletedNodeVersion) {
					tryDefineValue(versions, "node", snapshot.originalNodeVersion);
				}
			}

			const release = asRecord(p.release);
			if (release) {
				if (snapshot.mutatedReleaseName) {
					trySet(release, "name", snapshot.originalReleaseName);
				}
				if (snapshot.deletedReleaseName) {
					tryDefineValue(release, "name", snapshot.originalReleaseName);
				}
			}
		}
	} catch {
		// ignore
	}
}
